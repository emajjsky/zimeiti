from datetime import datetime
import json
import os
from pathlib import Path
import re

from playwright.sync_api import sync_playwright


ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
UPLOAD_SAMPLE = ARTIFACTS / "project-reference.txt"
UPLOAD_SAMPLE.write_text("项目素材上传验收", encoding="utf-8")


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


with sync_playwright() as playwright:
    executable = chrome_path()
    browser = playwright.chromium.launch(headless=True, **({"executable_path": executable} if executable else {}))
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

    page.goto("http://127.0.0.1:5173")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="创建新工作室").click()
    unique = datetime.now().strftime("%Y%m%d%H%M%S%f")
    page.get_by_label("你的名称").fill("创作验收")
    page.get_by_label("工作室名称").fill("Skill 验收工作室")
    page.get_by_label("邮箱").fill(f"creative-{unique}@example.com")
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
    assert page.locator(".creative-skill-panel").count() == 0
    assert page.get_by_text("Skill 组合", exact=True).count() == 0
    assert page.get_by_role("button", name="配图").is_disabled()
    assert page.get_by_role("button", name="排版").is_disabled()
    assert page.get_by_role("button", name="审核").is_disabled()
    assert page.get_by_text("视频号", exact=True).count() == 0

    target = page.get_by_label("目标受众")
    target.fill("想提高内容效率但不熟悉技术的普通创作者")
    with page.expect_response(lambda response: "/creative/projects/" in response.url and response.request.method == "PUT" and response.status == 200):
        page.get_by_role("button", name="保存概览").click()
    page.get_by_text("已保存", exact=False).wait_for()
    assert "view=create" in page.url
    assert "project=" in page.url
    page.screenshot(path=ARTIFACTS / "creative-brief-desktop.png", full_page=True)

    page.locator(".creative-stepper button").filter(has_text="资料与研究").click()
    page.wait_for_selector(".project-materials")
    page.get_by_role("button", name="新增内容").click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_label("项目内容标题").fill("必须保留的个人观点")
    dialog.get_by_label("项目内容正文").fill("判断 AI 工具时，先验证真实任务，再比较功能数量。")
    dialog.get_by_role("button", name="保存", exact=True).click()
    page.get_by_text("必须保留的个人观点", exact=True).wait_for()

    page.get_by_role("button", name="编辑 必须保留的个人观点").click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_label("项目内容标题").fill("必须保留的核心观点")
    dialog.get_by_role("button", name="保存", exact=True).click()
    page.get_by_text("必须保留的核心观点", exact=True).wait_for()

    page.locator(".materials-tabs button").filter(has_text="参考链接").click()
    page.get_by_role("button", name="新增参考").click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_label("参考资料标题").fill("官方产品说明")
    dialog.get_by_label("参考资料链接").fill("https://example.com/product")
    dialog.get_by_label("参考资料备注").fill("用于核验产品能力")
    dialog.get_by_role("button", name="保存", exact=True).click()
    page.get_by_text("官方产品说明", exact=True).wait_for()

    page.locator(".materials-tabs button").filter(has_text="素材文件").click()
    page.get_by_role("button", name="上传素材").click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_label("素材文件").set_input_files(str(UPLOAD_SAMPLE))
    dialog.get_by_label("参考资料备注").fill("用户提供的文本素材")
    dialog.get_by_role("button", name="保存", exact=True).click()
    page.get_by_text("project-reference.txt", exact=True).wait_for()

    assert page.locator(".project-progress-band").count() == 1
    assert page.locator(".project-research-agent").count() == 1
    assert page.get_by_text("已选 3 条资料", exact=True).count() == 1
    page.locator(".project-agent-composer textarea").fill("保留我的观点，核验产品能力和价格，生成研究计划。")
    page.get_by_role("button", name="准备计划", exact=True).click()
    page.get_by_text("请先在“核心 Agent”配置可用的规划模型。", exact=True).wait_for()
    assert page.get_by_role("button", name="去配置", exact=True).count() == 1
    assert page.locator(".project-progress-band li.done").count() == 2
    assert page.locator(".project-progress-band li.current").get_by_text("研究计划", exact=True).count() == 1
    page.screenshot(path=ARTIFACTS / "creative-research-agent-desktop.png", full_page=True)

    research_state = {"status": "DRAFT", "input_ids": [], "reference_ids": []}

    def research_context():
        run = {
            "id": "66666666-6666-4666-8666-666666666666",
            "status": research_state["status"],
            "request": "保留我的观点，核验产品能力和价格，生成研究计划。",
            "model": "qwen-plus",
            "actionVersion": "project-research-plan:1.0.0",
            "materialIds": {"inputIds": research_state["input_ids"], "referenceIds": research_state["reference_ids"]},
            "materialCount": len(research_state["input_ids"]) + len(research_state["reference_ids"]),
            "createdAt": "2026-07-27T10:00:00.000Z",
        }
        plan = None
        messages = [{"id": "message-user", "role": "USER", "content": run["request"], "runId": run["id"], "createdAt": run["createdAt"]}]
        if research_state["status"] == "SUCCEEDED":
            messages.append({"id": "message-agent", "role": "ASSISTANT", "content": "先核验官方能力和价格，再判断普通用户是否适用。", "runId": run["id"], "createdAt": "2026-07-27T10:01:00.000Z"})
            plan = {
                "id": "77777777-7777-4777-8777-777777777777",
                "runId": run["id"],
                "title": "AI 工具价值判断研究计划",
                "summary": "先核验官方能力和价格，再判断普通用户是否适用。",
                "questions": [{"question": "产品当前开放哪些能力？", "why": "避免引用过期信息。", "preferredSources": ["官方文档", "官方价格页"]}],
                "claims": [{"claim": "该能力对免费用户开放。", "priority": "HIGH", "reason": "影响使用建议。"}],
                "nextActions": [{"action": "SEARCH_WEB", "purpose": "查找最新官方说明。", "target": "产品名 官方文档 2026"}],
                "createdAt": "2026-07-27T10:01:00.000Z",
            }
        return {"messages": messages, "run": run, "plan": plan, "usedMaterialIds": {"inputIds": research_state["input_ids"], "referenceIds": research_state["reference_ids"]} if plan else {"inputIds": [], "referenceIds": []}}

    def mock_research(route):
        if route.request.method == "POST":
            payload = json.loads(route.request.post_data or "{}")
            research_state["status"] = "DRAFT"
            research_state["input_ids"] = payload["inputIds"]
            research_state["reference_ids"] = payload["referenceIds"]
            route.fulfill(status=201, content_type="application/json", body=json.dumps(research_context()["run"], ensure_ascii=False))
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps(research_context(), ensure_ascii=False))

    def mock_confirm_research(route):
        research_state["status"] = "SUCCEEDED"
        route.fulfill(status=202, content_type="application/json", body='{"id":"66666666-6666-4666-8666-666666666666","status":"QUEUED","jobId":"88888888-8888-4888-8888-888888888888"}')

    research_route_pattern = re.compile(r".*/api/v1/creative/projects/[^/]+/research(?:/prepare)?$")
    research_confirm_pattern = re.compile(r".*/api/v1/creative/research-runs/[^/]+/confirm$")
    page.route(research_route_pattern, mock_research)
    page.route(research_confirm_pattern, mock_confirm_research)
    page.get_by_role("button", name="准备计划", exact=True).click()
    page.get_by_text("生成研究计划", exact=True).wait_for()
    assert page.get_by_text("qwen-plus", exact=True).count() == 1
    page.screenshot(path=ARTIFACTS / "creative-research-confirmation.png", full_page=True)
    page.get_by_role("button", name="确认调用", exact=True).click()
    page.get_by_text("AI 工具价值判断研究计划", exact=True).wait_for()
    assert page.get_by_text("研究已引用", exact=True).count() == 1
    assert page.locator(".project-progress-band li.done").count() == 3
    page.screenshot(path=ARTIFACTS / "creative-research-plan.png", full_page=True)

    page.set_viewport_size({"width": 1024, "height": 900})
    page.wait_for_timeout(200)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    materials_box = page.locator(".project-materials").bounding_box()
    agent_box = page.locator(".project-research-agent").bounding_box()
    assert materials_box and agent_box and agent_box["y"] > materials_box["y"]
    page.screenshot(path=ARTIFACTS / "creative-research-agent-tablet.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.unroute(research_route_pattern)
    page.unroute(research_confirm_pattern)

    page.locator(".materials-tabs button").filter(has_text="参考链接").click()
    page.once("dialog", lambda confirm: confirm.accept())
    page.get_by_role("button", name="删除 官方产品说明").click()
    page.get_by_text("还没有参考链接", exact=True).wait_for()
    page.screenshot(path=ARTIFACTS / "creative-materials-desktop.png", full_page=True)

    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_selector(".creative-brief-form")
    assert page.get_by_label("目标受众").input_value() == "想提高内容效率但不熟悉技术的普通创作者"

    page.locator(".creative-stepper button").filter(has_text="资料与研究").click()
    page.get_by_text("必须保留的核心观点", exact=True).wait_for()
    page.screenshot(path=ARTIFACTS / "creative-materials-desktop.png", full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(200)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path=ARTIFACTS / "creative-materials-mobile-page.png", full_page=True)
    page.get_by_role("button", name="编辑 必须保留的核心观点").click()
    page.screenshot(path=ARTIFACTS / "creative-materials-mobile.png", full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.get_by_role("button", name="关闭", exact=True).click()
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.locator(".materials-tabs button").filter(has_text="素材文件").click()
    page.get_by_text("project-reference.txt", exact=True).wait_for()

    page.locator(".creative-stepper button").filter(has_text="文案").click()
    page.wait_for_selector(".creative-agent-panel")
    strategy = page.locator(".writing-strategy")
    assert strategy.locator("select").count() == 3
    assert strategy.locator("input").count() == 1
    assert strategy.get_by_text("排版", exact=True).count() == 0
    assert strategy.get_by_text("公众号文案 · 公众号规则", exact=True).count() == 1
    page.locator(".editor-head .tabs").get_by_role("button", name="小红书", exact=True).click()
    assert strategy.get_by_text("小红书文案 · 小红书规则", exact=True).count() == 1
    page.locator(".editor-head .tabs").get_by_role("button", name="公众号", exact=True).click()
    page.get_by_role("button", name="生成大纲", exact=True).click()
    page.get_by_text("请先为文案生成配置可用文本模型。", exact=True).wait_for()
    console_errors.clear()
    page.screenshot(path=ARTIFACTS / "creative-outline-model-blocked.png", full_page=True)
    page.get_by_role("button", name="去配置任务策略", exact=True).click()
    page.wait_for_selector(".policy-selector")
    assert "view=settings" in page.url
    assert "model=policies" in page.url

    def mock_outline(route):
        if "latest-run" in route.request.url:
            route.fulfill(status=200, content_type="application/json", body='{"id":"11111111-1111-4111-8111-111111111111","status":"SUCCEEDED","createdAt":"2026-07-27T08:00:00.000Z","confirmation":{"model":"qwen-plus","platform":"WECHAT","actionVersion":"creative-outline:1.1.0","promptVersion":1,"skills":[]}}')
            return
        route.fulfill(status=200, content_type="application/json", body='{"id":"22222222-2222-4222-8222-222222222222","projectId":"mock-project","platform":"WECHAT","status":"CANDIDATE","selectedTitle":null,"titleOptions":["普通人判断 AI 工具，先看这三件事","别被功能数量骗了"],"summary":"从真实问题、使用成本和可验证结果三个角度建立判断框架。","sections":[{"heading":"先定义真实问题","purpose":"明确工具要解决什么","keyPoints":["写下具体任务","确认输入和输出"]},{"heading":"计算完整成本","purpose":"比较学习与使用代价","keyPoints":["订阅费用","时间成本"]},{"heading":"验证实际结果","purpose":"用结果而不是演示判断","keyPoints":["设置验收标准"]}],"factsToVerify":["核验产品当前价格"],"model":"qwen-plus","createdAt":"2026-07-27T08:00:00.000Z","acceptedAt":null}')

    def mock_accept_outline(route):
        route.fulfill(status=200, content_type="application/json", body='{"candidate":{"id":"22222222-2222-4222-8222-222222222222","projectId":"mock-project","platform":"WECHAT","status":"ACCEPTED","selectedTitle":"普通人判断 AI 工具，先看这三件事","titleOptions":["普通人判断 AI 工具，先看这三件事","别被功能数量骗了"],"summary":"从真实问题、使用成本和可验证结果三个角度建立判断框架。","sections":[{"heading":"先定义真实问题","purpose":"明确工具要解决什么","keyPoints":["写下具体任务","确认输入和输出"]},{"heading":"计算完整成本","purpose":"比较学习与使用代价","keyPoints":["订阅费用","时间成本"]},{"heading":"验证实际结果","purpose":"用结果而不是演示判断","keyPoints":["设置验收标准"]}],"factsToVerify":["核验产品当前价格"],"model":"qwen-plus","createdAt":"2026-07-27T08:00:00.000Z","acceptedAt":"2026-07-27T08:30:00.000Z"},"project":{"id":"mock-project","title":"普通人如何判断一个 AI 工具是否值得使用","status":"WRITING","coreViewpoint":"先看真实问题、使用成本和可验证结果，不追逐功能数量。","factChecks":[],"versions":[{"id":"mock-version","platform":"WECHAT","status":"DRAFT","title":"普通人判断 AI 工具，先看这三件事","body":"先看真实问题、使用成本和可验证结果，不追逐功能数量。","updatedAt":"08:30"}],"updatedAt":"08:30"}}')

    draft_state = {"status": None}
    draft_body = """为什么先定义问题

很多人选择 AI 工具时，先比较功能数量。真正决定工具是否值得使用的，是它能否稳定解决你的具体问题。

算清完整成本

除了订阅费用，还要计算学习、整理输入和核验输出所花的时间。把这些成本和节省的时间放在一起比较，结论才有意义。

用结果完成验证

选择一个真实任务，提前写下验收标准。完成后检查结果是否准确、过程是否可重复，再决定要不要继续使用。"""

    def draft_candidate(status="CANDIDATE"):
        return {"id": "44444444-4444-4444-8444-444444444444", "projectId": "mock-project", "platform": "WECHAT", "outlineCandidateId": "22222222-2222-4222-8222-222222222222", "status": status, "title": "普通人判断 AI 工具，先看这三件事", "body": draft_body, "factsToVerify": ["核验产品当前价格"], "model": "qwen-plus", "promptVersion": 1, "createdAt": "2026-07-27T09:00:00.000Z", "acceptedAt": "2026-07-27T09:10:00.000Z" if status == "ACCEPTED" else None}

    def mock_draft_project(route):
        url = route.request.url
        if url.endswith("/draft/prepare"):
            draft_state["status"] = "DRAFT"
            route.fulfill(status=201, content_type="application/json", body=json.dumps({"id": "33333333-3333-4333-8333-333333333333", "status": "DRAFT", "createdAt": "2026-07-27T08:50:00.000Z", "confirmation": {"model": "qwen-plus", "platform": "WECHAT", "actionVersion": "creative-draft:1.0.0", "promptVersion": 1, "skills": [], "costEstimate": None}}, ensure_ascii=False))
            return
        if "latest-run" in url:
            if not draft_state["status"]:
                route.fulfill(status=200, content_type="application/json", body="null")
                return
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"id": "33333333-3333-4333-8333-333333333333", "status": draft_state["status"], "createdAt": "2026-07-27T08:50:00.000Z", "confirmation": {"model": "qwen-plus", "platform": "WECHAT", "actionVersion": "creative-draft:1.0.0", "promptVersion": 1, "skills": []}}, ensure_ascii=False))
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps(draft_candidate() if draft_state["status"] == "SUCCEEDED" else None, ensure_ascii=False))

    def mock_confirm_draft(route):
        draft_state["status"] = "SUCCEEDED"
        route.fulfill(status=202, content_type="application/json", body='{"id":"33333333-3333-4333-8333-333333333333","status":"QUEUED","jobId":"55555555-5555-4555-8555-555555555555"}')

    def mock_accept_draft(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"candidate": draft_candidate("ACCEPTED"), "project": {"id": "mock-project", "title": "普通人如何判断一个 AI 工具是否值得使用", "status": "WRITING", "coreViewpoint": "先看真实问题、使用成本和可验证结果，不追逐功能数量。", "factChecks": ["核验产品当前价格"], "versions": [{"id": "mock-version", "platform": "WECHAT", "status": "DRAFT", "title": "普通人判断 AI 工具，先看这三件事", "body": draft_body, "updatedAt": "09:10"}], "updatedAt": "09:10"}}, ensure_ascii=False))

    page.route("**/api/v1/creative/projects/*/outline/**", mock_outline)
    page.route("**/api/v1/creative/outline-candidates/*/accept", mock_accept_outline)
    page.route("**/api/v1/creative/projects/*/draft/**", mock_draft_project)
    page.route("**/api/v1/creative/draft-runs/*/confirm", mock_confirm_draft)
    page.route("**/api/v1/creative/draft-candidates/*/accept", mock_accept_draft)
    page.get_by_role("button", name="创作", exact=True).click()
    page.wait_for_selector(".creative-stepper")
    page.locator(".creative-stepper button").filter(has_text="文案").click()
    page.wait_for_selector(".outline-dialog")
    assert page.locator(".editor .outline-review").count() == 0
    page.get_by_role("button", name="关闭大纲", exact=True).click()
    page.wait_for_selector(".outline-dialog", state="detached")
    assert page.get_by_text("大纲待审核", exact=True).count() == 1
    assert page.get_by_role("button", name="审核大纲", exact=True).count() == 1
    body_editor = page.locator(".editor-document textarea").nth(1)
    assert body_editor.evaluate("element => getComputedStyle(element).overflowY === 'hidden'")
    assert body_editor.evaluate("element => element.clientHeight >= element.scrollHeight")
    page.get_by_role("button", name="审核大纲", exact=True).click()
    page.wait_for_selector(".outline-dialog")
    page.screenshot(path=ARTIFACTS / "creative-outline-candidate-desktop.png", full_page=True)

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(350)
    page.screenshot(path=ARTIFACTS / "creative-copy-mobile.png", full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    assert page.locator(".sidebar").bounding_box()["x"] < 0
    page.get_by_role("button", name="关闭大纲", exact=True).click()
    page.wait_for_selector(".outline-dialog", state="detached")

    page.set_viewport_size({"width": 1440, "height": 1000})
    page.wait_for_timeout(350)
    page.get_by_role("button", name="审核大纲", exact=True).click()
    page.get_by_role("button", name="采用大纲", exact=True).click()
    page.wait_for_selector(".outline-dialog", state="detached")
    assert page.get_by_text("大纲已采用", exact=True).count() == 1
    assert page.get_by_text("下一步：生成初稿", exact=True).count() == 1
    assert page.get_by_role("button", name="查看大纲", exact=True).count() == 1
    assert "##" not in body_editor.input_value()
    original_body = body_editor.input_value()
    page.get_by_role("button", name="生成初稿", exact=True).click()
    page.get_by_text("确认生成初稿", exact=True).wait_for()
    assert page.get_by_text("公众号图文 · 提示词 V1", exact=True).count() == 1
    page.get_by_role("button", name="确认生成", exact=True).click()
    page.wait_for_selector(".draft-review-dialog", timeout=10000)
    assert body_editor.input_value() == original_body
    assert page.get_by_text("采用后才会写入正文", exact=True).count() == 1
    page.screenshot(path=ARTIFACTS / "creative-draft-candidate-desktop.png", full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(200)
    page.screenshot(path=ARTIFACTS / "creative-draft-candidate-mobile.png")
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.get_by_role("button", name="采用为正文", exact=True).click()
    page.wait_for_selector(".draft-review-dialog", state="detached")
    assert body_editor.input_value() == draft_body
    assert "##" not in body_editor.input_value()
    assert page.get_by_text("初稿已采用", exact=True).count() == 1
    page.get_by_role("button", name="今天", exact=True).click()
    page.wait_for_selector(".today-layout")
    current = datetime.now()
    assert page.get_by_role("heading", name=f"今天，{current.month} 月 {current.day} 日").count() == 1
    assert page.get_by_text("完善创作设定：普通人如何判断一个 AI 工具是否值得使用", exact=True).count() == 1
    assert page.get_by_text("今天，7 月 22 日", exact=True).count() == 0
    assert page.get_by_text("审核小红书 8 页图文", exact=True).count() == 0
    page.screenshot(path=ARTIFACTS / "today-real-data.png", full_page=True)
    page.get_by_role("button", name="设置", exact=True).click()
    page.get_by_role("button", name="模型与 API", exact=True).click()
    page.get_by_role("button", name="提示词模板", exact=True).click()
    page.wait_for_selector(".prompt-template-settings")
    template_tabs = page.locator(".prompt-template-tabs")
    assert template_tabs.get_by_role("button").count() == 3
    template_tabs.get_by_role("button", name="生成初稿", exact=True).click()
    platform_tabs = page.locator(".prompt-platform-tabs")
    assert platform_tabs.get_by_role("button").count() == 2
    page.get_by_label("生成初稿 · 公众号图文提示词", exact=True).wait_for()
    wechat_template = page.get_by_label("生成初稿 · 公众号图文提示词", exact=True).input_value()
    assert "公众号图文" in wechat_template
    platform_tabs.get_by_role("button", name="小红书图文", exact=True).click()
    page.get_by_label("生成初稿 · 小红书图文提示词", exact=True).wait_for()
    xhs_template = page.get_by_label("生成初稿 · 小红书图文提示词", exact=True).input_value()
    assert "小红书图文" in xhs_template
    assert wechat_template != xhs_template
    page.screenshot(path=ARTIFACTS / "prompt-template-tabs-desktop.png", full_page=True)
    page.reload()
    page.wait_for_selector(".prompt-template-settings")
    assert "model=templates" in page.url
    assert template_tabs.get_by_role("button", name="生成初稿", exact=True).count() == 1
    assert not console_errors, console_errors
    browser.close()
