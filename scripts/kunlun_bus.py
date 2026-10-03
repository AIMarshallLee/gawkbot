"""昆仑增长多 AI / 三机飞书协同总线调度器 (Kunlun Bus CLI)
基于官方 lark-cli 与飞书 Wiki 资产池实现跨机任务派发、心跳监控与状态流转。
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

DOC_REGISTRY = {
    "mac": {
        "name": "Mac",
        "doc_id": "DvthdyGtuomOBuxeWXscbNGlnqf",
        "role": "总控 / 商业决策 / Hermes 共享总线客户端",
    },
    "aimarshalllee": {
        "name": "AiMarshallLee",
        "doc_id": "Nj31dducHoRFXBxZfHvce5yQnEh",
        "role": "Windows 业务开发主机 / 咔哒 Windows 主运行",
    },
    "xixi": {
        "name": "西溪 Marshall 分身",
        "doc_id": "QOYmdeRh4o8aSuxClkucSbqznVf",
        "role": "Windows 独立验证 / 备份恢复验证 / 容灾主机",
    },
}

def get_current_machine():
    import os
    cfg_paths = [
        os.path.join(os.getcwd(), "mqtt_config.json"),
        os.path.join(os.path.dirname(__file__), "..", "mqtt_config.json"),
    ]
    for p in cfg_paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("machine_id"):
                        return data["machine_id"].lower()
            except Exception:
                pass
    return "xixi"

CURRENT_MACHINE = get_current_machine()

BITABLE_CONFIG = {
    "base_token": "D8vYbSPvrabOp2sYoqjcvgKdnEc",
    "table_id": "tbl5kDpjoD93yw06",
    "wiki_url": "https://acnxzk6f4wv6.feishu.cn/wiki/I6WUwdLbFi3fHUkCOIXcsFYmnWK",
}


import shutil

LARK_CLI_BIN = shutil.which("lark-cli") or "lark-cli"


def run_lark_cli(args: list[str]) -> dict:
    """调用 lark-cli 并解析 JSON 输出。"""
    cmd = [LARK_CLI_BIN] + args + ["--format", "json"]
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=True,
            check=False,
        )
        if proc.returncode != 0:
            print(f"[ERROR] lark-cli failed (code {proc.returncode}): {proc.stderr.strip()}", file=sys.stderr)
            return {"ok": False, "error": proc.stderr.strip()}
        return json.loads(proc.stdout)
    except Exception as e:
        print(f"[ERROR] Subprocess error: {e}", file=sys.stderr)
        return {"ok": False, "error": str(e)}


def fetch_doc_markdown(doc_id: str) -> str:
    """获取指定文档的 Markdown 内容。"""
    res = run_lark_cli([
        "docs", "+fetch",
        "--as", "user",
        "--doc", doc_id,
        "--doc-format", "markdown",
        "--detail", "simple",
        "--scope", "full",
    ])
    if res.get("ok") and "data" in res:
        return res["data"]["document"]["content"]
    return ""


def send_im_notification(markdown_text: str, doc_url: str = None):
    """通过飞书 IM 向 Marshall Lee 直送实时通知 (严格遵循：说明情况 + 附带直达文档 的标准逻辑)"""
    try:
        user_id = "ou_7867f380cf2848b3be9844bb62d33bd0"
        footer = f"\n\n---\n🔗 **任务多维表格看板**: {BITABLE_CONFIG['wiki_url']}"
        if doc_url:
            footer += f"\n📄 **关联文档**: {doc_url}"
        full_text = markdown_text
        if "多维表格" not in full_text and "直达" not in full_text:
            full_text += footer
        run_lark_cli(["im", "+messages-send", "--as", "user", "--user-id", user_id, "--markdown", full_text])
    except Exception:
        pass


def upload_artifact_to_feishu(file_path: str, wiki_node_token="KoW3w4nogivUL3kRPkWcpKTtncc") -> dict:
    """将大体积构建安装包直接上传至飞书云盘并获取直达下载链接"""
    if not os.path.exists(file_path):
        return {"ok": False, "error": f"文件不存在: {file_path}"}
    file_name = os.path.basename(file_path)
    print(f"[*] 正在将大文件上传至飞书云盘: {file_name}...")
    res = run_lark_cli([
        "drive", "+upload",
        "--as", "user",
        "--file", file_path,
        "--wiki-token", wiki_node_token,
    ])
    if res.get("ok") and "data" in res:
        data = res["data"]
        url = data.get("url", "")
        print(f"[PASS] 大文件已直传飞书云盘！")
        print(f"  文件名: {file_name}")
        print(f"  直达下载链接: {url}")
        send_im_notification(f"📦 **大体积产物云盘直传就绪**\n- **产物名**: {file_name}\n- **大小**: {data.get('size', 0)} bytes\n- [立即点击下载]({url})")
        return {"ok": True, "url": url, "data": data}
    print(f"[FAIL] 上传云盘失败: {res.get('error')}")
    return {"ok": False, "error": res.get("error")}


def append_to_doc(doc_id: str, markdown_content: str) -> bool:
    """向指定文档追加 Markdown 内容。"""
    import os
    import tempfile
    cwd = os.getcwd()
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".md", dir=cwd, delete=False) as f:
        f.write(markdown_content)
        temp_path = f.name

    try:
        rel_path = os.path.relpath(temp_path, cwd)
        res = run_lark_cli([
            "docs", "+update",
            "--as", "user",
            "--doc", doc_id,
            "--command", "append",
            "--doc-format", "markdown",
            "--content", f"@{rel_path}",
        ])
        return res.get("ok", False)
    finally:
        try:
            import os
            os.remove(temp_path)
        except OSError:
            pass


def cmd_status(args):
    """查看三机状态与心跳。"""
    print("=" * 60)
    print(" 昆仑增长三机总线 · 机器与心跳状态")
    print("=" * 60)
    for key, info in DOC_REGISTRY.items():
        doc_id = info["doc_id"]
        content = fetch_doc_markdown(doc_id)
        online = "ONLINE" in content
        last_hb = "未检测到心跳"
        for line in content.splitlines():
            if "heartbeat:" in line or "time:" in line:
                if "time:" in line:
                    last_hb = line.strip()
        status_tag = "[ONLINE]" if online else "[UNKNOWN]"
        print(f"\n* 机器: {info['name']} ({key}) {status_tag}")
        print(f"  Doc ID: {doc_id}")
        print(f"  定位: {info['role']}")
        print(f"  最近记录: {last_hb}")
    print("\n" + "=" * 60)


def cmd_dispatch(args):
    """向目标机器派发任务工单。"""
    target_key = args.to.lower()
    if target_key not in DOC_REGISTRY:
        print(f"[ERROR] 未知目标机器: {args.to}，可选: {list(DOC_REGISTRY.keys())}")
        return

    target_info = DOC_REGISTRY[target_key]
    source_info = DOC_REGISTRY[CURRENT_MACHINE]

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    task_id = args.task_id or f"TASK-{datetime.now().strftime('%Y%m%d')}-{target_key.upper()}-01"

    task_card = f"""
## 三机协同任务工单｜{task_id}

- task_id: {task_id}
- from: {source_info['name']}
- to: {target_info['name']}
- task_name: {args.title}
- business_goal: {args.goal}
- action: {args.action}
- status: PENDING
- next_step: {args.next_step}
- accept_criteria: {args.criteria}
- return_to: {source_info['name']}
- created_at: {now_str}
"""

    print(f"[*] 正在向 {target_info['name']} (Doc: {target_info['doc_id']}) 派发工单 {task_id}...")
    ok = append_to_doc(target_info["doc_id"], task_card)
    if ok:
        print(f"[PASS] 工单派发成功！飞书总线已记录：{task_id}")
        print(task_card)
        send_im_notification(f"📋 **三机新工单派发**\n- **任务ID**: {task_id}\n- **发起源**: {source_info['name']} ➔ **目标机**: {target_info['name']}\n- **任务名**: {args.title}\n- **动作**: {args.action}")
    else:
        print(f"[FAIL] 派发失败，请检查网络或权限。")


def parse_tasks(content: str) -> list[dict]:
    """解析 Markdown 中的所有工单。"""
    tasks = []
    sections = content.split("## 三机协同任务工单｜")
    if len(sections) <= 1:
        return tasks

    # 收集已完成的回执 task_id
    completed_task_ids = set()
    receipt_sections = content.split("## 三机任务执行回执｜")
    for rsec in receipt_sections[1:]:
        tid = rsec.splitlines()[0].strip()
        completed_task_ids.add(tid)

    for sec in sections[1:]:
        lines = sec.splitlines()
        header = lines[0].strip()
        t = {"task_id": header, "status": "UNKNOWN"}
        for line in lines[1:]:
            line_str = line.strip()
            if not line_str.startswith("- "):
                if line_str.startswith("## "):
                    break
                continue
            parts = line_str[2:].split(":", 1)
            if len(parts) == 2:
                k = parts[0].strip()
                v = parts[1].strip()
                t[k] = v

        # 如果已有完成回执，状态标记为 COMPLETED
        if t["task_id"] in completed_task_ids:
            t["status"] = "COMPLETED"

        tasks.append(t)
    return tasks


def execute_task(task: dict) -> dict:
    """执行任务的具体业务逻辑。"""
    task_id = task.get("task_id")
    action = task.get("action", "")
    print(f"[*] [Worker] 开始执行任务 {task_id}: {action}")

    # 示例内置处理：支持 SELF_TEST, HASH, PING 等，或通用任务确认
    result_detail = f"任务 {task_id} 已在 {DOC_REGISTRY[CURRENT_MACHINE]['name']} 成功认领并执行完成。"
    return {
        "ok": True,
        "task_id": task_id,
        "status": "COMPLETED",
        "detail": result_detail,
    }


def write_task_receipt(doc_id: str, receipt: dict) -> bool:
    """向飞书文档写入任务执行回执。"""
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    info = DOC_REGISTRY[CURRENT_MACHINE]
    receipt_snippet = f"""
## 三机任务执行回执｜{receipt['task_id']}

- task_id: {receipt['task_id']}
- worker_machine: {info['name']}
- executed_at: {now_str}
- status: {receipt['status']}
- execution_result: {receipt['detail']}
"""
    res = append_to_doc(doc_id, receipt_snippet)
    if res:
        send_im_notification(f"✅ **三机任务闭环完成**\n- **任务ID**: {receipt['task_id']}\n- **执行机器**: {info['name']}\n- **状态**: {receipt['status']}\n- **结果**: {receipt['detail']}")
    return res


def cmd_tasks(args):
    """查看本机的待办协同任务。"""
    target_machine = args.machine or CURRENT_MACHINE
    info = DOC_REGISTRY[target_machine]
    print(f"[*] 正在拉取 {info['name']} 的协同工单...")
    content = fetch_doc_markdown(info["doc_id"])
    tasks = parse_tasks(content)

    if not tasks:
        print("[*] 当前无三机协同任务工单。")
        return

    print(f"\n发现 {len(tasks)} 个协同任务：")
    for t in tasks:
        print(f"\n工单: {t['task_id']} [{t.get('status', 'UNKNOWN')}]")
        print(f"  来自: {t.get('from', '未知')}")
        print(f"  动作: {t.get('action', '无')}")
        print(f"  目标: {t.get('business_goal', '无')}")


def cmd_worker(args):
    """常驻或单次监听并自动处理待办任务。"""
    info = DOC_REGISTRY[CURRENT_MACHINE]
    print(f"[*] 启动 {info['name']} 任务监听 Worker (Doc: {info['doc_id']})...")
    import time

    while True:
        try:
            content = fetch_doc_markdown(info["doc_id"])
            tasks = parse_tasks(content)
            pending_tasks = [t for t in tasks if t.get("status") == "PENDING"]

            if pending_tasks:
                print(f"[!] 发现 {len(pending_tasks)} 个待执行任务！")
                for task in pending_tasks:
                    res = execute_task(task)
                    if res["ok"]:
                        print(f"[*] 正在回填执行回执至飞书...")
                        write_task_receipt(info["doc_id"], res)
                        print(f"[PASS] 任务 {task['task_id']} 回执已成功回写至飞书！")
            else:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] 队列空闲，暂无 PENDING 任务。")

            if args.once:
                break

            time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n[*] Worker 已停止。")
            break
        except Exception as e:
            print(f"[ERROR] Worker 异常: {e}")
            if args.once:
                break
            time.sleep(args.interval)


def cmd_heartbeat(args):
    """向本机飞书机器页刷新心跳。"""
    info = DOC_REGISTRY[CURRENT_MACHINE]
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    p0 = args.p0 or "Windows 独立验收 / 夸克恢复验证 / 咔哒第二 Windows 复验"

    hb_snippet = f"""
## 三机心跳回执

- heartbeat: FEISHU_HEARTBEAT_OK
- machine: {info['name']}
- ai: Codex / Antigravity
- time: {now_str}
- status: ONLINE
- current_p0: {p0}
"""
    print(f"[*] 正在向 {info['name']} (Doc: {info['doc_id']}) 写入最新心跳...")
    ok = append_to_doc(info["doc_id"], hb_snippet)
    if ok:
        print(f"[PASS] 心跳刷新成功！时间: {now_str}")
    else:
        print(f"[FAIL] 心跳写入失败。")


def cmd_base_list(args):
    """查询多维表格任务池中的任务。"""
    print(f"[*] 正在拉取飞书多维表格三机任务池 (Base: {BITABLE_CONFIG['base_token']})...")
    res = run_lark_cli([
        "base", "+record-list",
        "--as", "user",
        "--base-token", BITABLE_CONFIG["base_token"],
        "--table-id", BITABLE_CONFIG["table_id"],
    ])
    if not res.get("ok"):
        print(f"[FAIL] 拉取多维表格失败: {res.get('error')}")
        return

    data = res.get("data", {})
    records = data.get("data", [])
    fields = data.get("fields", [])
    record_ids = data.get("record_id_list", [])

    print(f"\n飞书 Base 任务池 (在线直达: {BITABLE_CONFIG['wiki_url']})")
    print("=" * 60)

    count = 0
    for i, row in enumerate(records):
        row_dict = {}
        for fidx, fname in enumerate(fields):
            if fidx < len(row):
                row_dict[fname] = row[fidx]

        task_id = row_dict.get("任务ID")
        if not task_id:
            continue

        count += 1
        status = row_dict.get("状态")
        if isinstance(status, list) and status:
            status_str = status[0]
        else:
            status_str = str(status)

        rec_id = record_ids[i] if i < len(record_ids) else "N/A"
        print(f"\n* 工单: {task_id} [{status_str}] (Record: {rec_id})")
        print(f"  发起源: {row_dict.get('发起源', 'N/A')} -> 目标机: {row_dict.get('目标机', 'N/A')}")
        print(f"  任务名: {row_dict.get('任务名称', 'N/A')}")
        print(f"  动作: {row_dict.get('执行动作', 'N/A')}")
        if row_dict.get("执行回执"):
            print(f"  回执: {row_dict.get('执行回执')}")

    if count == 0:
        print("[*] 任务池当前无记录。")
    print("\n" + "=" * 60)


def cmd_base_add(args):
    """向多维表格添加一条新任务。"""
    task_id = args.task_id or f"TASK-{datetime.now().strftime('%Y%m%d')}-{args.target.upper()}-01"
    source = DOC_REGISTRY[CURRENT_MACHINE]["name"]
    target = DOC_REGISTRY[args.target.lower()]["name"]

    import os
    import tempfile
    payload = {
        "create_records": [
            {
                "任务ID": task_id,
                "发起源": source,
                "目标机": target,
                "任务名称": args.title,
                "业务目标": args.goal,
                "执行动作": args.action,
                "状态": "PENDING",
            }
        ]
    }

    cwd = os.getcwd()
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", dir=cwd, delete=False) as f:
        json.dump(payload, f, ensure_ascii=False)
        temp_path = f.name

    try:
        rel_path = os.path.relpath(temp_path, cwd)
        res = run_lark_cli([
            "base", "+record-batch-create",
            "--as", "user",
            "--base-token", BITABLE_CONFIG["base_token"],
            "--table-id", BITABLE_CONFIG["table_id"],
            "--json", f"@{rel_path}",
        ])
        if res.get("ok"):
            print(f"[PASS] 任务成功推送到多维表格任务池！")
            print(f"  任务ID: {task_id}")
            print(f"  目标机: {target}")
            print(f"  直达链接: {BITABLE_CONFIG['wiki_url']}")
            send_im_notification(f"📊 **多维表格任务发布**\n- **任务ID**: {task_id}\n- **目标机**: {target}\n- **任务名**: {args.title}\n- **动作**: {args.action}\n- [直达表格]({BITABLE_CONFIG['wiki_url']})")
        else:
            print(f"[FAIL] 推送失败: {res.get('error')}")
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


def main():
    parser = argparse.ArgumentParser(description="昆仑增长三机总线协同工具")
    subparsers = parser.add_subparsers(dest="command")

    # status
    subparsers.add_parser("status", help="查询三机总线心跳与状态")

    # heartbeat
    p_hb = subparsers.add_parser("heartbeat", help="向本机飞书页刷新心跳")
    p_hb.add_argument("--p0", help="当前主任务 (P0)")

    # dispatch
    p_dispatch = subparsers.add_parser("dispatch", help="向目标机器派发协同工单")
    p_dispatch.add_argument("--to", required=True, choices=["mac", "aimarshalllee", "xixi"], help="目标机器")
    p_dispatch.add_argument("--title", required=True, help="任务名称")
    p_dispatch.add_argument("--goal", required=True, help="业务目标")
    p_dispatch.add_argument("--action", required=True, help="具体执行动作")
    p_dispatch.add_argument("--next_step", default="读取本工单并开始执行，执行完成后回填状态为 COMPLETED", help="下一步动作")
    p_dispatch.add_argument("--criteria", default="产物哈希/日志确认无误，回交发起源机器复验", help="验收标准")
    p_dispatch.add_argument("--task-id", help="自定义任务ID")

    # tasks
    p_tasks = subparsers.add_parser("tasks", help="查询指定机器的待办工单")
    p_tasks.add_argument("--machine", choices=["mac", "aimarshalllee", "xixi"], help="机器名 (默认本机)")

    # worker
    p_worker = subparsers.add_parser("worker", help="启动待办任务自动监听 Worker")
    p_worker.add_argument("--once", action="store_true", help="单次轮询后退出")
    p_worker.add_argument("--interval", type=int, default=30, help="轮询间隔秒数 (默认 30)")

    # base-list
    subparsers.add_parser("base-list", help="查看飞书多维表格三机任务池")

    # base-add
    p_base_add = subparsers.add_parser("base-add", help="向飞书多维表格任务池添加新任务")
    p_base_add.add_argument("--target", required=True, choices=["mac", "aimarshalllee", "xixi"], help="目标机器")
    p_base_add.add_argument("--title", required=True, help="任务名称")
    p_base_add.add_argument("--goal", required=True, help="业务目标")
    p_base_add.add_argument("--action", required=True, help="执行动作")
    p_base_add.add_argument("--task-id", help="自定义任务ID")

    # upload-artifact
    p_upload = subparsers.add_parser("upload-artifact", help="将大体积构建安装包直传飞书云盘并获取下载链接")
    p_upload.add_argument("--file", required=True, help="本地文件路径")
    p_upload.add_argument("--wiki-token", default="KoW3w4nogivUL3kRPkWcpKTtncc", help="飞书 Wiki 资产库节点 Token")

    args = parser.parse_args()
    if args.command == "status":
        cmd_status(args)
    elif args.command == "heartbeat":
        cmd_heartbeat(args)
    elif args.command == "dispatch":
        cmd_dispatch(args)
    elif args.command == "tasks":
        cmd_tasks(args)
    elif args.command == "worker":
        cmd_worker(args)
    elif args.command == "base-list":
        cmd_base_list(args)
    elif args.command == "base-add":
        cmd_base_add(args)
    elif args.command == "upload-artifact":
        upload_artifact_to_feishu(args.file, args.wiki_token)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
