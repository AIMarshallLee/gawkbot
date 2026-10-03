"""昆仑增长多 AI / 三机应用层 MQTT 即时协同总线 (Kunlun MQTT Bus)
纯应用层 TCP/TLS 通信，不安装虚拟网卡，不修改系统路由表，绝不影响本地代理。
支持毫秒级跨公网远程指令调用、即时心跳、任务分发与结果回传。
"""

import argparse
import json
import ssl
import sys
import os
import shutil
import subprocess
import time
import uuid
from datetime import datetime

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

# 机器注册表
MACHINES = {
    "xixi": "西溪 Marshall 分身 (Windows 独立验证)",
    "aimarshalllee": "AiMarshallLee (Windows 业务开发主机)",
    "mac": "Mac (Hermes 总控 / 决策)",
}

CURRENT_MACHINE = "xixi"

import os

# 默认专属 Topic 命名空间 (隔离公共 broker 噪声)
DEFAULT_NAMESPACE = "kunlun_bus_f380"
DEFAULT_BROKER = "broker.emqx.io"
DEFAULT_PORT = 1883
DEFAULT_TLS_PORT = 8883

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def load_config(config_path=None) -> dict:
    """自动加载 EMQX Cloud 配置文件 (若存在)"""
    candidates = [
        config_path,
        os.path.join(os.getcwd(), "mqtt_config.json"),
        os.path.join(os.path.dirname(__file__), "..", "mqtt_config.json"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            try:
                with open(c, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    print(f"[*] 已载入配置文件: {c}")
                    return data
            except Exception as e:
                print(f"[!] 读取配置文件 {c} 失败: {e}", file=sys.stderr)
def execute_local_ai(prompt_text: str) -> dict:
    """自动探测本机可用的 AI 引擎并执行任务 (优先支持 Hermes Agent，兼顾 Codex、Claude)"""
    import urllib.request
    import urllib.error

    # 1. 优先探测 Hermes Agent HTTP 网关 (默认端口 8642)
    hermes_urls = [
        "http://127.0.0.1:8642/v1/chat/completions",
        "http://localhost:8642/v1/chat/completions",
    ]
    for url in hermes_urls:
        try:
            req_data = json.dumps({
                "model": "hermes-agent",
                "messages": [{"role": "user", "content": prompt_text}],
                "temperature": 0.7,
            }).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=req_data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                choices = data.get("choices", [])
                if choices:
                    content = choices[0].get("message", {}).get("content", "")
                    return {"engine": "hermes-gateway", "output": content, "status": "SUCCESS"}
        except Exception:
            pass

    # 2. 探测 Hermes 本地命令行 (/usr/local/bin/hermes 或 PATH)
    hermes_bin = shutil.which("hermes") or ("/usr/local/bin/hermes" if os.path.exists("/usr/local/bin/hermes") else None)
    if hermes_bin:
        for subcmd in [["run", prompt_text], ["chat", "-m", prompt_text], [prompt_text]]:
            try:
                proc = subprocess.run(
                    [hermes_bin] + subcmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=60,
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    return {"engine": "hermes-cli", "output": proc.stdout.strip(), "status": "SUCCESS"}
            except Exception:
                pass

    # 3. 探测 Codex CLI
    codex_bin = shutil.which("codex")
    if codex_bin:
        try:
            proc = subprocess.run(
                [codex_bin, "exec", prompt_text],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
            )
            return {"engine": "codex", "output": proc.stdout.strip(), "status": "SUCCESS" if proc.returncode == 0 else "ERROR"}
        except Exception as e:
            return {"engine": "codex", "error": str(e), "status": "FAILED"}

    # 4. 探测 Claude Code CLI
    claude_bin = shutil.which("claude")
    if claude_bin:
        try:
            proc = subprocess.run(
                [claude_bin, "-p", prompt_text],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
            )
            return {"engine": "claude", "output": proc.stdout.strip(), "status": "SUCCESS" if proc.returncode == 0 else "ERROR"}
        except Exception as e:
            return {"engine": "claude", "error": str(e), "status": "FAILED"}

    return {"engine": "none", "error": "未检测到运行中的 Hermes 服务(:8642) 或 Codex/Claude 命令行", "status": "NO_AI_ENGINE"}


class KunlunMQTTBus:
    def __init__(self, machine_id=CURRENT_MACHINE, namespace=DEFAULT_NAMESPACE, broker=DEFAULT_BROKER, port=DEFAULT_PORT, use_tls=False, username=None, password=None):
        self.machine_id = machine_id.lower()
        self.namespace = namespace
        self.broker = broker
        self.port = port
        self.use_tls = use_tls
        self.username = username
        self.password = password
        self.client_id = f"kunlun-{self.machine_id}-{uuid.uuid4().hex[:6]}"

        self.client = mqtt.Client(
            callback_api_version=CallbackAPIVersion.VERSION2,
            client_id=self.client_id,
            protocol=mqtt.MQTTv311,
        )

        if self.username and self.password:
            self.client.username_pw_set(self.username, self.password)

        if self.use_tls:
            self.client.tls_set(cert_reqs=ssl.CERT_NONE)
            self.client.tls_insecure_set(True)

        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.on_disconnect = self._on_disconnect

        self.connected = False
        self.pending_replies: dict[str, dict] = {}
        self.message_handlers = []

    def _get_inbox_topic(self, machine_id=None):
        mid = (machine_id or self.machine_id).lower()
        return f"{self.namespace}/machine/{mid}/inbox"

    def _get_outbox_topic(self, machine_id=None):
        mid = (machine_id or self.machine_id).lower()
        return f"{self.namespace}/machine/{mid}/outbox"

    def _get_broadcast_topic(self):
        return f"{self.namespace}/broadcast"

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            self.connected = True
            # 订阅自己的专属收件箱和全员广播
            client.subscribe(self._get_inbox_topic())
            client.subscribe(self._get_broadcast_topic())
        else:
            print(f"[!] MQTT 连接失败，原因码: {reason_code}", file=sys.stderr)

    def _on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties=None):
        self.connected = False

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
            msg_id = payload.get("msg_id")
            msg_type = payload.get("type")
            source = payload.get("from")

            # 处理等待回执的消息
            if msg_type in ("ACK", "REPLY", "PONG") and msg_id in self.pending_replies:
                self.pending_replies[msg_id] = payload
                return

            # 调用已注册的处理函数
            for handler in self.message_handlers:
                handler(payload)

            # 默认控制台打印
            now = datetime.now().strftime("%H:%M:%S")
            action = str(payload.get("action", "")).upper()
            print(f"\n[{now}] 收到来自 [{source}] 的即时消息 ({msg.topic})")
            print(f"  类型: {msg_type} | 动作: {action}")
            print(f"  内容: {json.dumps(payload.get('payload', {}), ensure_ascii=False)}")

            # 1. 远程命令执行 (EXEC / SHELL)
            if action in ("EXEC", "SHELL"):
                pl = payload.get("payload", {})
                cmd_to_run = (pl.get("cmd") or pl.get("raw_text") or "") if isinstance(pl, dict) else str(pl)
                if cmd_to_run:
                    print(f"[*] [执行引擎] 运行本地命令: {cmd_to_run}")
                    try:
                        proc = subprocess.run(
                            cmd_to_run,
                            shell=True,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            text=True,
                            encoding="utf-8",
                            errors="replace",
                            timeout=30,
                        )
                        out = proc.stdout.strip()
                        err = proc.stderr.strip()
                        print(f"[*] 执行完成 (code {proc.returncode}): {out[:100]}...")
                        if payload.get("need_reply"):
                            self.reply(
                                source,
                                msg_id,
                                status="SUCCESS" if proc.returncode == 0 else "ERROR",
                                result={"stdout": out, "stderr": err, "code": proc.returncode},
                            )
                        return
                    except Exception as ex:
                        print(f"[!] 执行异常: {ex}")
                        if payload.get("need_reply"):
                            self.reply(source, msg_id, status="FAILED", result={"error": str(ex)})
                        return

            # 2. 远程 AI 任务唤醒 (AI / HERMES / CODEX)
            if action in ("AI", "HERMES", "CODEX"):
                pl = payload.get("payload", {})
                prompt_text = (pl.get("prompt") or pl.get("raw_text") or "") if isinstance(pl, dict) else str(pl)
                if prompt_text:
                    print(f"[*] [AI 引擎] 唤醒本机 AI (Hermes/Codex/Claude) 处理任务: {prompt_text}")
                    ai_res = execute_local_ai(prompt_text)
                    print(f"[*] AI 执行完毕: 引擎={ai_res.get('engine')}, 状态={ai_res.get('status')}")
                    if payload.get("need_reply"):
                        self.reply(source, msg_id, status=ai_res.get("status", "AI_DONE"), result=ai_res)
                    return

            # 3. 飞书协同任务即时触发 (TRIGGER / TRIGGER_WORK)
            if action in ("TRIGGER", "TRIGGER_WORK", "POLL_WORK"):
                print(f"[*] [触发引擎] 收到远程工单触发通知！立即启动飞书任务处理...")
                bus_script = os.path.join(os.path.dirname(__file__), "kunlun_bus.py")
                if os.path.exists(bus_script):
                    try:
                        proc = subprocess.run(
                            [sys.executable, bus_script, "worker", "--once"],
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            text=True,
                            encoding="utf-8",
                            errors="replace",
                            timeout=60,
                        )
                        out = proc.stdout.strip()
                        err = proc.stderr.strip()
                        print(f"[*] 飞书工单拉取执行完毕: {out[:120]}...")
                        if payload.get("need_reply"):
                            self.reply(
                                source,
                                msg_id,
                                status="TRIGGER_DONE" if proc.returncode == 0 else "TRIGGER_ERROR",
                                result={"stdout": out, "stderr": err, "code": proc.returncode},
                            )
                        return
                    except Exception as ex:
                        print(f"[!] 触发执行异常: {ex}")
                        if payload.get("need_reply"):
                            self.reply(source, msg_id, status="TRIGGER_FAILED", result={"error": str(ex)})
                        return

            # 4. 常规消息 ACK 回执
            if payload.get("need_reply"):
                self.reply(source, msg_id, status="ACK", result="Message received and acknowledged.")
        except Exception as e:
            print(f"[!] 解析 MQTT 消息异常: {e}", file=sys.stderr)

    def connect(self, timeout=5.0):
        self.client.connect_async(self.broker, self.port, keepalive=60)
        self.client.loop_start()
        start = time.time()
        while not self.connected and (time.time() - start) < timeout:
            time.sleep(0.05)
        return self.connected

    def disconnect(self):
        self.client.loop_stop()
        self.client.disconnect()

    def register_handler(self, fn):
        self.message_handlers.append(fn)

    def send_message(self, to_machine: str, action: str, data: dict = None, msg_type="CMD", need_reply=False, timeout=5.0) -> dict | None:
        """向目标机器发送指令/消息，支持等待同步返回。"""
        if not self.connected:
            raise ConnectionError("MQTT 未连接")

        msg_id = f"MSG-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4]}"
        packet = {
            "msg_id": msg_id,
            "type": msg_type,
            "from": self.machine_id,
            "to": to_machine.lower(),
            "action": action,
            "payload": data or {},
            "need_reply": need_reply,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

        if to_machine.lower() == "all":
            topic = self._get_broadcast_topic()
        else:
            topic = self._get_inbox_topic(to_machine)

        if need_reply:
            self.pending_replies[msg_id] = None

        self.client.publish(topic, json.dumps(packet, ensure_ascii=False), qos=1)

        if not need_reply:
            return {"msg_id": msg_id, "status": "SENT"}

        # 等待同步回执
        start = time.time()
        while (time.time() - start) < timeout:
            if self.pending_replies.get(msg_id) is not None:
                reply = self.pending_replies.pop(msg_id)
                return reply
            time.sleep(0.05)

        self.pending_replies.pop(msg_id, None)
        return None

    def reply(self, to_machine: str, original_msg_id: str, status="OK", result=None):
        """向发信机器回送 ACK 或执行结果。"""
        reply_packet = {
            "msg_id": original_msg_id,
            "type": "REPLY",
            "from": self.machine_id,
            "to": to_machine.lower(),
            "status": status,
            "result": result or {},
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        topic = self._get_inbox_topic(to_machine)
        self.client.publish(topic, json.dumps(reply_packet, ensure_ascii=False), qos=1)


def make_bus(args, machine_id=None) -> KunlunMQTTBus:
    """结合配置文件与命令行参数构建总线客户端"""
    cfg = load_config(getattr(args, "config", None))
    broker = getattr(args, "broker", None) or cfg.get("broker") or DEFAULT_BROKER
    namespace = getattr(args, "namespace", None) or cfg.get("namespace") or DEFAULT_NAMESPACE
    use_tls = cfg.get("use_tls", False) or getattr(args, "use_tls", False)
    default_p = DEFAULT_TLS_PORT if use_tls else DEFAULT_PORT
    port = getattr(args, "port", None) or cfg.get("port") or default_p
    mid = machine_id or getattr(args, "machine", None) or getattr(args, "sender", None) or cfg.get("machine_id") or CURRENT_MACHINE
    username = cfg.get("username") or os.environ.get("MQTT_USERNAME") or getattr(args, "username", None)
    password = cfg.get("password") or os.environ.get("MQTT_PASSWORD") or getattr(args, "password", None)

    return KunlunMQTTBus(
        machine_id=mid,
        namespace=namespace,
        broker=broker,
        port=port,
        use_tls=use_tls,
        username=username,
        password=password,
    )


# ==================== CLI 操作 ====================

def cmd_listen(args):
    """常驻监听模式。"""
    bus = make_bus(args, machine_id=args.machine)
    print("=" * 60)
    print(f" 昆仑增长三机 MQTT 即时总线 · 监听端 [{bus.machine_id}]")
    print(f" Broker: {bus.broker}:{bus.port} | 命名空间: {bus.namespace}")
    if bus.username:
        print(f" 鉴权身份: {bus.username} (EMQX Cloud 私有集群)")
    print("=" * 60)
    print("[*] 正在建立应用层纯长连接 (不修改系统网卡/路由，代理零影响)...")

    if not bus.connect(timeout=6.0):
        print("[FAIL] 无法连接到 MQTT Broker，请检查网络或账号配置。")
        return

    print(f"[PASS] 成功接入总线！当前监听收件箱: {bus._get_inbox_topic()} 与广播频道")
    print("[*] 等待其他电脑即时下发指令 (按 Ctrl+C 退出)...")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[*] 正在平稳断开总线...")
        bus.disconnect()
        print("[*] 已退出。")


def cmd_send(args):
    """向目标机发送即时指令。"""
    bus = make_bus(args, machine_id=args.sender)
    if not bus.connect(timeout=5.0):
        print("[FAIL] 无法连接到 MQTT Broker。")
        return

    payload_data = {}
    if args.data:
        try:
            payload_data = json.loads(args.data)
        except json.JSONDecodeError:
            payload_data = {"raw_text": args.data}

    print(f"[*] 正在向 [{args.to}] 发送即时指令: {args.action} ...")
    start = time.time()
    res = bus.send_message(
        to_machine=args.to,
        action=args.action,
        data=payload_data,
        need_reply=args.wait,
        timeout=args.timeout,
    )
    elapsed = (time.time() - start) * 1000

    if args.wait:
        if res:
            print(f"[PASS] 收到对端秒级即时回执！(耗时: {elapsed:.1f}ms)")
            print(f"  回执来源: {res.get('from')}")
            print(f"  状态: {res.get('status')}")
            print(f"  结果详情: {json.dumps(res.get('result', {}), ensure_ascii=False)}")
        else:
            print(f"[TIMEOUT] 指令已发出，但等待对端回执超时 ({args.timeout}s)。可能对端未在线监听。")
    else:
        print(f"[PASS] 指令已秒级投递至云端总线 (耗时: {elapsed:.1f}ms)，Message ID: {res['msg_id']}")

    bus.disconnect()


def cmd_ping(args):
    """向目标机器或广播探测往返网络延迟。"""
    bus = make_bus(args, machine_id=args.sender)
    if not bus.connect(timeout=5.0):
        print("[FAIL] 无法连接到 MQTT Broker。")
        return

    print(f"[*] 正在向 [{args.target}] 发送即时 Ping 探针...")
    start = time.time()
    res = bus.send_message(
        to_machine=args.target,
        action="PING",
        data={"ping_time": time.time()},
        msg_type="PING",
        need_reply=True,
        timeout=args.timeout,
    )
    elapsed = (time.time() - start) * 1000

    if res:
        print(f"[PONG] 探针成功返回！往返时延 (RTT): {elapsed:.1f} ms")
        print(f"  响应机器: {res.get('from')}")
    else:
        print(f"[TIMEOUT] 目标机器 [{args.target}] 未响应 Ping 探针 (超时 {args.timeout}s)。")

    bus.disconnect()


def cmd_loopback(args):
    """自发自收回环性能与全双工测试。"""
    print("=" * 60)
    print(" 昆仑增长三机 MQTT 即时总线 · 本机回环基准测试")
    print("=" * 60)
    bus = make_bus(args, machine_id="loopback_test")
    if not bus.connect(timeout=5.0):
        print("[FAIL] 无法连接 Broker。")
        return

    print("[1] 成功连接 MQTT Broker (纯应用层 TCP，不碰任何网卡与代理)")
    print("[2] 准备自发自收测试包...")

    def echo_handler(msg):
        if msg.get("action") == "LOOPBACK_TEST":
            bus.reply(msg["from"], msg["msg_id"], status="SUCCESS", result={"echo": msg["payload"], "server_time": time.time()})

    bus.register_handler(echo_handler)

    test_payload = {"test_task": "TASK-KADA-VERIFY", "code": 200, "detail": "Windows独立复验准备就绪"}
    start_time = time.time()
    res = bus.send_message(
        to_machine="loopback_test",
        action="LOOPBACK_TEST",
        data=test_payload,
        need_reply=True,
        timeout=4.0,
    )
    rtt_ms = (time.time() - start_time) * 1000

    if res:
        print(f"[PASS] 回环测试成功闭环！")
        print(f"  往返时延 (RTT): {rtt_ms:.1f} 毫秒")
        print(f"  发信机器: loopback_test -> 收信机器: loopback_test")
        print(f"  回执状态: {res.get('status')}")
        print(f"  携带产物: {json.dumps(res.get('result', {}), ensure_ascii=False)}")
        print("\n[结论] 纯应用层跨机即时总线完全可用，秒级穿透，零网络副作用！")
    else:
        print("[FAIL] 回环测试超时。")

    bus.disconnect()


def main():
    parser = argparse.ArgumentParser(description="昆仑增长三机 MQTT 即时协同总线")
    parser.add_argument("--config", help="MQTT 配置文件路径 (默认加载 mqtt_config.json)")
    parser.add_argument("--namespace", help=f"Topic 命名空间")
    parser.add_argument("--broker", help=f"MQTT Broker 地址")
    parser.add_argument("--port", type=int, help=f"端口")
    parser.add_argument("--use-tls", action="store_true", help="启用 TLS/SSL 加密")
    parser.add_argument("--username", help="EMQX 认证用户名")
    parser.add_argument("--password", help="EMQX 认证密码")

    subparsers = parser.add_subparsers(dest="subcommand")

    # listen
    p_listen = subparsers.add_parser("listen", help="启动本机即时监听服务")
    p_listen.add_argument("--machine", choices=list(MACHINES.keys()), help="本机标识")

    # send
    p_send = subparsers.add_parser("send", help="向目标机器发送即时指令")
    p_send.add_argument("--to", required=True, help="目标机器 (xixi / aimarshalllee / mac / all)")
    p_send.add_argument("--action", required=True, help="动作指令 (如: BUILD, RUN_TEST, SYNC)")
    p_send.add_argument("--data", help="JSON 字符串参数或普通文本")
    p_send.add_argument("--sender", help="发件人标识")
    p_send.add_argument("--wait", action="store_true", help="是否等待对端同步回执")
    p_send.add_argument("--timeout", type=float, default=5.0, help="等待超时秒数")

    # ping
    p_ping = subparsers.add_parser("ping", help="测试目标机器网络往返延迟")
    p_ping.add_argument("--target", default="all", help="目标机器 (默认 all 广播)")
    p_ping.add_argument("--sender", help="发信机器")
    p_ping.add_argument("--timeout", type=float, default=4.0, help="等待响应超时秒数")

    # loopback-test
    subparsers.add_parser("loopback-test", help="运行单机自发自收回环性能测试")

    args = parser.parse_args()
    if args.subcommand == "listen":
        cmd_listen(args)
    elif args.subcommand == "send":
        cmd_send(args)
    elif args.subcommand == "ping":
        cmd_ping(args)
    elif args.subcommand == "loopback-test":
        cmd_loopback(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

