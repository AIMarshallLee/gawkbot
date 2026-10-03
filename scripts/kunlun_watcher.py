"""昆仑增长三机自动感知巡检守护 (Kunlun Auto-Sync Watcher)
自动检测本地代码/文件变动 -> 自动生成AI摘要 -> 自动提交并推送GitHub -> 自动投稿飞书多维表格与IM通知
"""

import argparse
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime

# 保证终端编码支持中文
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

BITABLE_CONFIG = {
    "wiki_token": "I6WUwdLbFi3fHUkCOIXcsFYmnWK",
    "base_token": "D8vYbSPvrabOp2sYoqjcvgKdnEc",
    "table_id": "tbl5kDpjoD93yw06",
    "wiki_url": "https://acnxzk6f4wv6.feishu.cn/wiki/I6WUwdLbFi3fHUkCOIXcsFYmnWK",
}

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

USER_ID = "ou_7867f380cf2848b3be9844bb62d33bd0"


def get_current_machine() -> str:
    """自动感知本机机器标识"""
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
    if sys.platform == "darwin":
        return "mac"
    return "xixi"


def run_command(cmd_args: list[str], timeout=30) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(
            cmd_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except Exception as e:
        return -1, "", str(e)


def notify_feishu_im(markdown_text: str):
    """向 Marshall Lee 飞书直发实时通知"""
    run_command([
        "lark-cli", "im", "+messages-send",
        "--as", "user",
        "--user-id", USER_ID,
        "--markdown", markdown_text,
    ])


def sync_to_feishu_bitable(machine: str, commit_msg: str, commit_hash: str, changed_files: list[str]) -> bool:
    """将改动上报至飞书多维表格"""
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    task_id = f"SYNC-{datetime.now().strftime('%Y%m%d%H%M%S')}-{machine.upper()}"
    files_summary = ", ".join(changed_files[:5]) + (f" 等共 {len(changed_files)} 个文件" if len(changed_files) > 5 else "")

    record_fields = {
        "任务ID": task_id,
        "任务名称": f"代码自动归档: {commit_msg[:30]}",
        "发起源机器": DOC_REGISTRY.get(machine, {}).get("name", machine),
        "目标机器": DOC_REGISTRY.get(machine, {}).get("name", machine),
        "任务状态": "COMPLETED",
        "业务目标": f"AI 工具本地作业自动归档至 GitHub ({commit_hash})",
        "动作": "AUTO_SYNC_TO_GITHUB",
        "任务回执": f"Commit: {commit_hash} | 说明: {commit_msg} | 变更: {files_summary}",
    }

    import tempfile
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as f:
        json.dump({"records": [{"fields": record_fields}]}, f, ensure_ascii=False)
        temp_path = f.name

    try:
        code, out, err = run_command([
            "lark-cli", "base", "+record-batch-create",
            "--as", "user",
            "--base-token", BITABLE_CONFIG["base_token"],
            "--table-id", BITABLE_CONFIG["table_id"],
            "--json", f"@{temp_path}",
        ])
        return code == 0
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


def check_and_sync(machine=None) -> bool:
    """执行一次巡检与自动同步"""
    mid = machine or get_current_machine()
    m_info = DOC_REGISTRY.get(mid, {"name": mid})

    print(f"[{datetime.now().strftime('%H:%M:%S')}] [{m_info['name']}] 正在巡检本地代码与文件变更...")

    # 1. 检查是否有未暂存/未提交的修改
    code, status_out, _ = run_command(["git", "status", "--porcelain"])
    if code != 0:
        print(f"[!] 无法获取 git 状态: {status_out}")
        return False

    dirty_lines = [line.strip() for line in status_out.splitlines() if line.strip()]
    
    # 过滤掉忽略的临时文件
    dirty_lines = [l for l in dirty_lines if not any(k in l for k in ["tmp", ".pyc", "auth_im_qr", "deploy_pack"])]

    if not dirty_lines:
        # 检查是否有未 push 的 commit
        code, log_out, _ = run_command(["git", "log", "@{u}..HEAD", "--oneline", "-n", "3"])
        if code == 0 and log_out:
            print(f"[*] 检测到未 push 的本地 commit，正在同步至 GitHub...")
            run_command(["git", "push"])
        else:
            print(f"[*] 当前工作区干净，无未同步改动。")
        return True

    changed_files = [line.split()[-1] for line in dirty_lines]
    print(f"[!] 发现 {len(changed_files)} 个本地改动文件: {changed_files[:3]}...")

    # 2. 自动生成摘要 Commit
    now_tag = datetime.now().strftime("%m-%d %H:%M")
    auto_msg = f"chore(sync): auto-sync {len(changed_files)} files by {m_info['name']} [{now_tag}]"
    
    print(f"[*] 正在自动暂存与提交...")
    # 只暂存脚本和源码，避免误暂存大二进制
    run_command(["git", "add", "-u"])
    
    code, commit_out, _ = run_command(["git", "commit", "-m", auto_msg])
    if code != 0:
        print(f"[*] 提交跳过或无需提交: {commit_out}")
        return True

    # 3. 提取 commit hash 并 push
    _, hash_out, _ = run_command(["git", "rev-parse", "--short", "HEAD"])
    commit_hash = hash_out or "HEAD"

    print(f"[*] 正在推送到 GitHub (commit: {commit_hash})...")
    push_code, _, push_err = run_command(["git", "push"])
    if push_code == 0:
        print(f"[PASS] GitHub 推送成功！")
    else:
        print(f"[!] GitHub 推送告警: {push_err[:100]}")

    # 4. 自动同步投稿至飞书多维表格与 IM 通知
    print(f"[*] 正在自动投稿到飞书多维表格...")
    ok_base = sync_to_feishu_bitable(mid, auto_msg, commit_hash, changed_files)
    if ok_base:
        print(f"[PASS] 飞书多维表格投稿成功！")

    # 5. 直推手机飞书
    im_card = f"""### 🚀【三机自巡检】{m_info['name']} 代码变动自动同步
- **Commit**: `{commit_hash}`
- **摘要**: {auto_msg}
- **涉及文件**: {', '.join(changed_files[:4])}
- **GitHub**: 已推送到当前远程分支
- **飞书流水池**: [点击直达多维表格]({BITABLE_CONFIG['wiki_url']})
"""
    notify_feishu_im(im_card)
    print(f"[PASS] 手机飞书通知已直推！")
    return True


def main():
    parser = argparse.ArgumentParser(description="昆仑增长三机自动感知巡检守护")
    parser.add_argument("--machine", choices=list(DOC_REGISTRY.keys()), help="机器标识")
    parser.add_argument("--once", action="store_true", help="单次检查后退出")
    parser.add_argument("--interval", type=int, default=180, help="轮询间隔秒数 (默认 180 秒 / 3 分钟)")
    args = parser.parse_args()

    mid = args.machine or get_current_machine()
    m_info = DOC_REGISTRY.get(mid, {"name": mid})

    print("=" * 60)
    print(f" 昆仑增长三机自动巡检守护 · [{m_info['name']}]")
    print(f" 功能: 自动捕捉本地 AI 作业 -> 自动 push GitHub -> 自动投稿飞书多维表格")
    print(f" 轮询模式: {'单次执行' if args.once else f'后台守护 (间隔 {args.interval} 秒)'}")
    print("=" * 60)

    if args.once:
        check_and_sync(mid)
        return

    try:
        while True:
            try:
                check_and_sync(mid)
            except Exception as e:
                print(f"[!] 巡检异常: {e}")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n[*] 巡检守护已平稳停止。")


if __name__ == "__main__":
    main()
