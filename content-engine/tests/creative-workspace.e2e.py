from copy import deepcopy
from datetime import datetime
import json
import os
from pathlib import Path
import re
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright


ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)


def chrome_path():
    candidates = [
        os.getenv("PLAYWRIGHT_CHROME_PATH"),
        os.getenv("CHROME_PATH"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    return next((value for value in candidates if value and Path(value).exists()), None)


def json_response(route, body, status=200):
    route.fulfill(
        status=status,
        content_type="application/json",
        body=json.dumps(body, ensure_ascii=False),
    )


with sync_playwright() as playwright:
    executable = chrome_path()
    browser = playwright.chromium.launch(
        headless=True,
        **({"executable_path": executable} if executable else {}),
    )
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    console_errors = []
    failed_responses = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on(
        "response",
        lambda response: failed_responses.append(
            f"{response.request.method} {response.status} {response.url}"
        )
        if response.status >= 400
        else None,
    )

    page.goto("http://127.0.0.1:5173")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="创建新工作室").click()
    unique = datetime.now().strftime("%Y%m%d%H%M%S%f")
    page.get_by_label("你的名称").fill("文案验收")
    page.get_by_label("工作室名称").fill("四平台验收工作室")
    page.get_by_label("邮箱").fill(f"copy-{unique}@example.com")
    page.get_by_label("密码").fill("CreativeTest123!")
    page.get_by_role("button", name="创建并进入").click()
    page.get_by_role("button", name="进入内容引擎").click()
    page.get_by_role("button", name="新建选题").click()
    page.get_by_label("选题标题").fill("普通人如何判断一个 AI 工具是否值得使用")
    page.get_by_label("题材").fill("AI 工具实战")
    page.get_by_label("核心观点").fill("先看真实问题、使用成本和可验证结果，不追逐功能数量。")
    page.get_by_role("button", name="保存选题").click()
    page.get_by_role("button", name="确认立项").click()
    page.wait_for_selector(".creative-brief-form")

    assert page.locator(".creative-stepper button").count() == 6
    assert page.get_by_role("button", name="配图").is_disabled()
    assert page.get_by_role("button", name="排版").is_disabled()
    assert page.get_by_role("button", name="审核").is_disabled()
    assert page.get_by_text("视频号", exact=True).count() == 0

    page.get_by_label("目标受众").fill("想提高内容效率但不熟悉技术的普通创作者")
    save_overview = page.get_by_role("button", name="保存概览")
    assert not save_overview.is_disabled()
    with page.expect_response(
        lambda response: "/brief" in response.url
        and response.request.method == "PUT"
    ) as overview_response:
        save_overview.click()
    response = overview_response.value
    assert response.status == 200, response.text()
    try:
        page.get_by_text("已保存", exact=False).wait_for(timeout=10_000)
    except Exception as error:
        raise AssertionError(f"项目概览未保存，失败请求：{failed_responses}") from error

    workspace_payload = page.evaluate(
        """async () => {
          const response = await fetch('/api/v1/workspace/state', {
            headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem('content-engine-web-session-v1')).accessToken}` }
          });
          return response.json();
        }"""
    )
    project = next(
        item
        for item in workspace_payload["state"]["projects"]
        if item["title"] == "普通人如何判断一个 AI 工具是否值得使用"
    )
    project_state = {"project": deepcopy(project)}
    agent_state = {"WECHAT": "IDLE", "XIAOHONGSHU": "IDLE", "ZHIHU": "IDLE", "WEIBO": "IDLE"}
    agent_requests = {"WECHAT": "", "XIAOHONGSHU": "", "ZHIHU": "", "WEIBO": ""}
    intercepted_confirms = []
    candidate_body = """先定义要解决的问题

选择 AI 工具前，先写清楚真实任务、输入和验收标准。功能再多，无法稳定完成任务也没有价值。

算清完整使用成本

除了订阅费，还要计算学习、整理输入和核验结果的时间。

用真实结果做决定

拿一个日常任务连续验证三次，再决定是否长期使用。"""
    candidate_id = "44444444-4444-4444-8444-444444444444"
    run_id = "33333333-3333-4333-8333-333333333333"

    def version_for(platform):
        existing = next(
            (
                item
                for item in project_state["project"]["versions"]
                if item["platform"] == platform
            ),
            None,
        )
        if existing:
            return existing
        bodies = {"ZHIHU": "知乎独立草稿", "WEIBO": "微博独立草稿"}
        return {
            "id": f"mock-{platform.lower()}-version",
            "platform": platform,
            "status": "DRAFT",
            "title": f"{platform} 草稿",
            "body": bodies.get(platform, ""),
            "updatedAt": "10:00",
        }

    def mock_enable_platform(route):
        platform = urlparse(route.request.url).path.rsplit("/", 1)[-1]
        current = deepcopy(project_state["project"])
        created = not any(item["platform"] == platform for item in current["versions"])
        if created:
            current["versions"].append(version_for(platform))
        current["updatedAt"] = "10:00"
        project_state["project"] = current
        json_response(route, {"project": current, "platform": platform, "created": created})

    def artifact(status="CANDIDATE"):
        return {
            "id": candidate_id,
            "type": "PLATFORM_COPY",
            "status": status,
            "platform": "WECHAT",
            "version": 1,
            "parentArtifactId": None,
            "payload": {
                "title": "判断 AI 工具，先看这三件事",
                "body": candidate_body,
                "changeSummary": "保留核心观点，补全判断步骤并收紧表达。",
                "factsToVerify": ["核验产品当前价格和免费额度"],
            },
            "createdAt": "2026-07-27T10:01:00.000Z",
            "acceptedAt": "2026-07-27T10:02:00.000Z" if status == "ACCEPTED" else None,
        }

    def run(platform, status):
        return {
            "id": run_id,
            "action": "POLISH_EXISTING_DRAFT",
            "status": status,
            "request": agent_requests[platform],
            "confirmation": {
                "model": "qwen-plus",
                "promptVersion": 1,
                "skillNames": ["AI 科技", "清新自然", "公众号规则"],
                "materialCount": 0,
                "writeScope": "公众号正式文案候选",
            },
            "createdAt": "2026-07-27T10:00:00.000Z",
        }

    def context(platform):
        status = agent_state[platform]
        messages = []
        artifacts = []
        active_run = None
        if status != "IDLE":
            messages.append(
                {
                    "id": f"message-user-{platform}",
                    "role": "USER",
                    "content": agent_requests[platform],
                    "runId": run_id,
                    "stage": "COPY",
                    "messageType": "MESSAGE",
                    "artifactRefs": [],
                    "createdAt": "2026-07-27T10:00:00.000Z",
                }
            )
            active_run = run(platform, "DRAFT" if status == "DRAFT" else "SUCCEEDED")
        if status == "DRAFT":
            messages.append(
                {
                    "id": f"message-confirmation-{platform}",
                    "role": "ASSISTANT",
                    "content": "文案任务已准备，确认后生成候选。",
                    "runId": run_id,
                    "stage": "COPY",
                    "messageType": "CONFIRMATION",
                    "artifactRefs": [],
                    "createdAt": "2026-07-27T10:00:01.000Z",
                }
            )
        if status in ("SUCCEEDED", "ACCEPTED") and platform == "WECHAT":
            copy_artifact = artifact("ACCEPTED" if status == "ACCEPTED" else "CANDIDATE")
            artifacts.append(copy_artifact)
            messages.append(
                {
                    "id": "message-artifact-wechat",
                    "role": "ASSISTANT",
                    "content": "候选已生成，请审核差异后决定是否采用。",
                    "runId": run_id,
                    "stage": "COPY",
                    "messageType": "ARTIFACT",
                    "artifactRefs": [candidate_id],
                    "createdAt": "2026-07-27T10:01:00.000Z",
                }
            )
            if status == "ACCEPTED":
                messages.append(
                    {
                        "id": "message-accepted-wechat",
                        "role": "ASSISTANT",
                        "content": "候选已采用为公众号当前版本。",
                        "runId": run_id,
                        "stage": "COPY",
                        "messageType": "SYSTEM_EVENT",
                        "artifactRefs": [candidate_id],
                        "createdAt": "2026-07-27T10:02:00.000Z",
                    }
                )
        return {
            "stage": "COPY",
            "platform": platform,
            "messages": messages,
            "summaries": [],
            "activeRun": active_run,
            "artifacts": artifacts,
            "usedMaterialIds": {"inputIds": [], "referenceIds": []},
        }

    def mock_agent_context(route):
        platform = parse_qs(urlparse(route.request.url).query).get("platform", ["WECHAT"])[0]
        json_response(route, context(platform))

    def mock_prepare_agent(route):
        payload = json.loads(route.request.post_data or "{}")
        platform = payload["platform"]
        agent_requests[platform] = payload["request"]
        agent_state[platform] = "DRAFT"
        json_response(route, run(platform, "DRAFT"), status=201)

    def mock_confirm_agent(route):
        intercepted_confirms.append(route.request.url)
        agent_state["WECHAT"] = "SUCCEEDED"
        json_response(
            route,
            {"id": run_id, "status": "QUEUED", "jobId": "55555555-5555-4555-8555-555555555555"},
            status=202,
        )

    def mock_accept_artifact(route):
        agent_state["WECHAT"] = "ACCEPTED"
        accepted_project = deepcopy(project_state["project"])
        accepted_project["status"] = "WRITING"
        accepted_project["updatedAt"] = "10:02"
        for item in accepted_project["versions"]:
            if item["platform"] == "WECHAT":
                item.update(
                    {
                        "title": "判断 AI 工具，先看这三件事",
                        "body": candidate_body,
                        "updatedAt": "10:02",
                    }
                )
        project_state["project"] = accepted_project
        json_response(route, {"artifact": artifact("ACCEPTED"), "project": accepted_project})

    page.route("**/api/v1/creative/projects/*/platforms/*", mock_enable_platform)
    page.route(
        re.compile(r".*/api/v1/creative/projects/[^/]+/agent\?.*stage=COPY.*$"),
        mock_agent_context,
    )
    page.route("**/api/v1/creative/projects/*/agent/prepare", mock_prepare_agent)
    page.route("**/api/v1/creative/agent-runs/*/confirm", mock_confirm_agent)
    page.route("**/api/v1/creative/project-artifacts/*/accept", mock_accept_artifact)

    page.locator(".creative-stepper button").filter(has_text="文案").click()
    page.wait_for_selector(".copy-workspace")
    assert page.locator(".project-agent").count() == 1
    assert page.locator(".creative-agent-panel").count() == 0

    page.get_by_role("button", name="增加图文平台").click()
    page.get_by_role("button", name="知乎", exact=True).click()
    page.wait_for_function("document.querySelectorAll('.copy-platform-tabs button').length === 3")
    page.get_by_role("button", name="增加图文平台").click()
    page.get_by_role("button", name="微博", exact=True).click()
    page.wait_for_function("document.querySelectorAll('.copy-platform-tabs button').length === 4")
    assert page.locator(".copy-platform-tabs button").count() == 4

    length_input = page.get_by_label("目标篇幅")
    length_input.fill("1800-2200 字")
    page.get_by_text("请先保存写作策略", exact=True).wait_for()
    composer = page.locator(".project-agent-composer textarea")
    composer.fill("保留事实，把这篇文章润色得更自然。")
    assert page.get_by_role("button", name="发送", exact=True).is_disabled()
    page.get_by_role("button", name="保存策略", exact=True).click()
    page.get_by_role("button", name="已保存", exact=True).wait_for()

    page.locator(".copy-platform-tabs").get_by_role("button", name="公众号", exact=True).click()
    body_editor = page.locator(".copy-document textarea").nth(1)
    original_body = body_editor.input_value()
    body_editor.click()
    page.keyboard.press("Home")
    page.keyboard.down("Shift")
    for _ in range(min(8, len(original_body))):
        page.keyboard.press("ArrowRight")
    page.keyboard.up("Shift")
    page.get_by_text(re.compile(r"已选择 \d+ 字"), exact=False).wait_for()
    composer.fill("保留事实，把这篇文章润色得更自然。")
    page.get_by_role("button", name="发送", exact=True).click()
    page.get_by_text("润色文案", exact=True).wait_for()
    assert page.get_by_text("qwen-plus", exact=True).count() == 1
    page.get_by_role("button", name="确认调用", exact=True).click()
    page.get_by_role("button", name="查看候选", exact=True).click()
    page.get_by_role("heading", name="审核文案", exact=True).wait_for()
    assert body_editor.input_value() == original_body
    assert page.locator(".candidate-diff .added").count() > 0
    assert page.locator(".candidate-diff .removed").count() > 0
    assert page.get_by_text("核验产品当前价格和免费额度", exact=True).count() == 1
    page.screenshot(path=ARTIFACTS / "creative-copy-candidate-desktop.png", full_page=True)

    page.set_viewport_size({"width": 1024, "height": 900})
    page.wait_for_timeout(200)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.get_by_role("button", name="关闭候选", exact=True).click()
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(200)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path=ARTIFACTS / "creative-copy-mobile.png", full_page=True)

    page.set_viewport_size({"width": 1440, "height": 1000})
    page.get_by_role("button", name="查看候选", exact=True).click()
    page.get_by_role("button", name="采用为当前版本", exact=True).click()
    page.wait_for_selector(".copy-candidate-dialog", state="detached")
    assert body_editor.input_value() == candidate_body
    assert len(intercepted_confirms) == 1

    page.locator(".copy-platform-tabs").get_by_role("button", name="微博", exact=True).click()
    assert page.locator(".copy-document textarea").nth(1).input_value() == "微博独立草稿"
    page.locator(".copy-platform-tabs").get_by_role("button", name="公众号", exact=True).click()
    assert page.locator(".copy-document textarea").nth(1).input_value() == candidate_body

    page.reload()
    page.wait_for_selector(".creative-brief-form")
    page.locator(".creative-stepper button").filter(has_text="文案").click()
    page.wait_for_selector(".copy-workspace")
    restored_body = page.locator(".copy-document textarea").nth(1)
    assert restored_body.input_value() == candidate_body
    page.get_by_role("button", name=re.compile(r"版本 1")).click()
    assert page.get_by_text("已采用 · V1", exact=True).count() == 1
    assert page.get_by_text("候选已采用为公众号当前版本。", exact=True).count() == 1
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    assert not console_errors, console_errors
    browser.close()
