import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


BASE_URL = os.getenv("CONTENT_ENGINE_E2E_URL", "http://127.0.0.1:5173")
ARTIFACTS = Path(tempfile.gettempdir()) / "content-engine-visual-workspace-e2e"
ARTIFACTS.mkdir(exist_ok=True)
PROJECT_ID = "visual-project-1"
NOW = "2026-07-30T08:00:00.000Z"
COVER_ID = "11111111-1111-4111-8111-111111111111"
BODY_ID = "22222222-2222-4222-8222-222222222222"
GENERATED_ID = "33333333-3333-4333-8333-333333333333"
ONE_PIXEL_GIF = "R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
GENERATED_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#dceeff"/><rect x="70" y="70" width="1060" height="535" rx="16" fill="#fff" stroke="#17203b" stroke-width="6"/><text x="110" y="165" font-family="sans-serif" font-size="54" font-weight="700" fill="#17203b">天链三号 01 星</text><text x="110" y="235" font-family="sans-serif" font-size="28" fill="#40506f">中继卫星如何提升测控与数据传输</text><rect x="110" y="300" width="280" height="190" rx="12" fill="#ffd9e3"/><rect x="460" y="300" width="280" height="190" rx="12" fill="#fff1c7"/><rect x="810" y="300" width="280" height="190" rx="12" fill="#ccefdc"/></svg>"""
SESSION = {
    "accessToken": "mock-access-token",
    "user": {"id": "user-1", "email": "creator@example.com", "display_name": "验收用户"},
    "workspace": {"id": "workspace-1", "name": "验收工作空间"},
}


def chrome_path():
    candidates = [
        os.getenv("PLAYWRIGHT_CHROME_PATH"),
        os.getenv("CHROME_PATH"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    return next((value for value in candidates if value and Path(value).exists()), None)


def respond(route, payload, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(payload, ensure_ascii=False))


def assert_no_overflow(page, label):
    dimensions = page.evaluate("""() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth })""")
    assert dimensions["width"] <= dimensions["viewport"], f"{label} 横向溢出: {dimensions}"


def project():
    body = """天链三号01星由运载火箭送入预定轨道，这是我国新一代中继卫星系统建设的重要一步。

中继卫星承担航天器与地面站之间的数据转发任务，能够扩展测控覆盖范围，并提升数据传输效率。

理解这次发射，重点不只是成功入轨，还要关注后续组网、实际服务能力以及公开技术资料。"""
    return {
        "id": PROJECT_ID,
        "title": "我国成功发射天链三号01星",
        "originType": "MANUAL",
        "stage": "PLATFORM_ADAPTATION",
        "status": "WRITING",
        "planning": {
            "title": "我国成功发射天链三号01星", "category": "科技", "angle": "解释中继卫星的作用",
            "objective": "让普通读者理解这次发射", "targetAudience": "关注科技新闻的普通读者",
            "coreMessage": "新一代中继卫星将提升航天器测控与数据传输能力", "targetPlatforms": ["WECHAT", "XIAOHONGSHU", "ZHIHU", "WEIBO"],
            "timing": "TODAY", "sourceRequirements": "使用公开资料", "constraints": "不夸大技术能力",
        },
        "planningVersion": 1,
        "coreViewpoint": "中继卫星是航天器与地面之间的重要通信桥梁。",
        "factChecks": [],
        "versions": [
            {"id": "version-1", "platform": "WECHAT", "title": "我国成功发射天链三号01星", "body": body, "status": "PREFLIGHT_PASSED", "updatedAt": NOW},
            {"id": "version-2", "platform": "XIAOHONGSHU", "title": "天链三号01星有什么用", "body": body, "status": "DRAFT", "updatedAt": NOW},
            {"id": "version-3", "platform": "ZHIHU", "title": "如何理解天链三号01星", "body": body, "status": "DRAFT", "updatedAt": NOW},
            {"id": "version-4", "platform": "WEIBO", "title": "天链三号01星发射", "body": body, "status": "DRAFT", "updatedAt": NOW},
        ],
        "sourceSnapshot": {},
        "delivery": {"platforms": {"WECHAT": {"stage": "VISUAL", "visual": {
            "planVersion": 1,
            "coverReferenceId": COVER_ID,
            "assetReferenceIds": [COVER_ID, BODY_ID],
            "assets": [],
            "plan": [
                {"id": "old-cover", "role": "COVER", "assetReferenceId": COVER_ID},
                {"id": "old-body", "role": "BODY", "assetReferenceId": BODY_ID},
            ],
            "updatedAt": NOW,
        }, "review": None}}},
        "createdAt": NOW,
        "updatedAt": NOW,
    }


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, **({"executable_path": chrome_path()} if chrome_path() else {}))
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    state = {"project": project(), "searches": [], "visual_writes": 0, "generations": 0, "generation_payloads": [], "unexpected": [], "console_errors": [], "references": [
        {"id": COVER_ID, "title": "旧封面", "url": f"data:image/gif;base64,{ONE_PIXEL_GIF}", "role": "VISUAL", "scope": "IMAGING", "platforms": ["WECHAT"], "sourceType": "LINK", "mimeType": "image/gif", "notes": "", "createdAt": NOW, "updatedAt": NOW},
        {"id": BODY_ID, "title": "旧正文火箭图", "url": f"data:image/gif;base64,{ONE_PIXEL_GIF}", "role": "VISUAL", "scope": "IMAGING", "platforms": ["WECHAT"], "sourceType": "LINK", "mimeType": "image/gif", "notes": "", "createdAt": NOW, "updatedAt": NOW},
    ]}
    page.on("console", lambda message: state["console_errors"].append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: state["console_errors"].append(str(error)))
    page.add_init_script("window.localStorage.setItem('content-engine-web-session-v1', " + json.dumps(json.dumps(SESSION, ensure_ascii=False)) + ");")

    def handle_api(route):
        request = route.request
        path = urlparse(request.url).path
        method = request.method
        if path == "/api/v1/auth/me":
            return respond(route, {"user": SESSION["user"], "workspace": SESSION["workspace"]})
        if path == "/api/v1/workspace/state":
            return respond(route, {"state": {"workspace": {"name": "验收工作空间", "enabledPlatforms": ["WECHAT"], "setupCompleted": True}, "sources": [], "intelligence": [], "topics": [], "projects": [state["project"]]}, "revision": 1, "updatedAt": NOW})
        if path == "/api/v1/creative/projects" and method == "GET":
            return respond(route, {"projects": [state["project"]]})
        if path == "/api/v1/creative/skills":
            return respond(route, [])
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/brief" and method == "GET":
            return respond(route, {"brief": {"objective": "让普通读者理解这次发射", "targetAudience": "普通读者", "coreMessage": "解释中继卫星", "sourceRequirements": "公开资料", "lengthTarget": "1500-2500 字", "selectedPlatforms": ["WECHAT"], "notes": "", "selectedSkills": {"SUBJECT": "", "CONTENT_TYPE": "", "VOICE": "", "LAYOUT": "", "CHANNEL": ""}, "platformSkills": {}, "accountVoiceProfileId": "", "voiceOffset": "DEFAULT"}})
        if path in ("/api/v1/settings/account-voices", "/api/v1/account-voices"):
            return respond(route, {"voices": []})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/materials":
            return respond(route, {"inputs": [], "references": state["references"]})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/visual/generate" and method == "POST":
            state["generations"] += 1
            state["generation_payloads"].append(json.loads(request.post_data or "{}"))
            reference = {"id": GENERATED_ID, "title": "AI 图文信息图", "url": None, "role": "VISUAL", "scope": "IMAGING", "platforms": ["WECHAT"], "sourceType": "FILE", "mimeType": "image/svg+xml", "notes": "AI 生图", "createdAt": NOW, "updatedAt": NOW}
            state["references"] = [reference, *[item for item in state["references"] if item["id"] != GENERATED_ID]]
            return respond(route, {"reference": reference}, status=201)
        if path == f"/api/v1/creative/project-files/{GENERATED_ID}/content" and method == "GET":
            return route.fulfill(status=200, content_type="image/svg+xml", body=GENERATED_SVG)
        if path == "/api/v1/creative/image-search":
            query = request.url.split("q=", 1)[-1]
            state["searches"].append(query)
            return respond(route, {"provider": "Wikimedia Commons", "results": [
                {"id": "image-1", "title": "Satellite launch", "thumbnailUrl": "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "imageUrl": "https://commons.wikimedia.org/wiki/File:Satellite.jpg", "sourceUrl": "https://commons.wikimedia.org/", "license": "CC BY-SA", "attribution": "Test"},
                {"id": "image-2", "title": "Relay satellite", "thumbnailUrl": "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "imageUrl": "https://commons.wikimedia.org/wiki/File:Relay_satellite.jpg", "sourceUrl": "https://commons.wikimedia.org/", "license": "Public domain", "attribution": "Test"},
            ]})
        if path == f"/api/v1/creative/projects/{PROJECT_ID}/visual" and method == "PUT":
            payload = json.loads(request.post_data or "{}")
            state["visual_writes"] += 1
            state["project"]["delivery"]["platforms"]["WECHAT"]["visual"] = {
                "planVersion": payload["planVersion"],
                "styleProfile": payload["styleProfile"],
                "coverReferenceId": payload["coverReferenceId"], "assetReferenceIds": payload["assetReferenceIds"],
                "assets": [], "plan": payload["plan"], "updatedAt": NOW,
            }
            return respond(route, {"project": state["project"]})
        if path in ("/api/v1/intelligence/sources", "/api/v1/intelligence/items"):
            return respond(route, [])
        state["unexpected"].append(f"{method} {path}")
        return respond(route, {"error": {"message": f"未配置接口: {method} {path}"}}, status=418)

    page.route("**/api/v1/**", handle_api)
    page.goto(f"{BASE_URL}/?view=create&project={PROJECT_ID}&stage=master&platform=WECHAT")
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="公众号配图", exact=True).wait_for()
    channel_nav = page.locator(".channel-workbench-nav").bounding_box()
    platform_nav = page.locator(".channel-platform-tabs").bounding_box()
    step_nav = page.locator(".channel-step-tabs").bounding_box()
    channel_nav_style = page.locator(".channel-workbench-nav").evaluate("element => { const style = getComputedStyle(element); const platform = getComputedStyle(element.querySelector('.channel-platform-tabs')); const button = getComputedStyle(element.querySelector('.channel-platform-tabs button')); return { display: style.display, minHeight: style.minHeight, height: style.height, padding: style.padding, gap: style.gap, alignItems: style.alignItems, platformHeight: platform.height, platformPadding: platform.padding, buttonHeight: button.height, buttonMinHeight: button.minHeight, buttonPadding: button.padding } }")
    assert channel_nav and channel_nav["height"] <= 64, f"桌面渠道导航过高: {channel_nav}, platform={platform_nav}, steps={step_nav}, style={channel_nav_style}"
    assert platform_nav and step_nav and abs(platform_nav["y"] - step_nav["y"]) <= 4, "渠道与步骤导航没有在同一行"
    assert page.locator(".channel-platform-tabs button").count() == 4
    page.get_by_text("封面 1 张，正文插图 2 张", exact=True).wait_for()
    page.get_by_role("button", name=re.compile(r"文章封面")).wait_for()
    page.get_by_role("button", name=re.compile(r"正文插图 1")).wait_for()
    page.get_by_role("button", name="增加正文插图").click()
    page.get_by_text("封面 1 张，正文插图 3 张", exact=True).wait_for()
    page.get_by_role("button", name=re.compile(r"正文插图 3")).wait_for()
    page.wait_for_timeout(900)
    assert len(state["project"]["delivery"]["platforms"]["WECHAT"]["visual"]["plan"]) == 4
    page.get_by_role("button", name="减少正文插图").click()
    page.get_by_text("封面 1 张，正文插图 2 张", exact=True).wait_for()
    page.get_by_role("button", name="增加正文插图").click()
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="重新规划").click()
    page.get_by_text("封面 1 张，正文插图 3 张", exact=True).wait_for()
    page.wait_for_timeout(900)
    page.reload()
    page.wait_for_load_state("networkidle")
    page.get_by_text("封面 1 张，正文插图 3 张", exact=True).wait_for()
    page.get_by_role("button", name=re.compile(r"正文插图 3")).wait_for()
    assert page.locator(".visual-plan-state", has_text="待选图").count() >= 2, "旧版正文错误绑定没有在升级时清空"
    page.get_by_role("button", name=re.compile(r"天链三号01星")).first.wait_for()
    assert not state["searches"], "进入配图页或刷新时不应自动产生图片检索请求"
    page.locator(".visual-query-chips button").first.click()
    page.get_by_text("Satellite launch", exact=True).wait_for()
    assert len(state["searches"]) == 1, "点击推荐关键词后应只执行一次图片检索"
    page.get_by_role("button", name=re.compile(r"正文插图 1")).click()
    page.get_by_text(re.compile(r"概念示意图|场景图|数据图")).first.wait_for()
    assert len(state["searches"]) == 1, "切换配图项时不应自动产生新的图片检索请求"
    for _ in range(20):
        if state["visual_writes"]:
            break
        page.wait_for_timeout(100)
    assert state["visual_writes"] >= 1, "自动生成的配图方案没有保存"
    assert state["project"]["delivery"]["platforms"]["WECHAT"]["visual"]["planVersion"] == 4
    assert all(item["assetReferenceId"] is None for item in state["project"]["delivery"]["platforms"]["WECHAT"]["visual"]["plan"][1:])
    page.get_by_role("button", name=re.compile(r"文章封面")).click()
    page.get_by_role("button", name="AI 生图", exact=True).click()
    page.get_by_label("项目默认风格").select_option("RETRO_POP")
    page.get_by_label("视觉结构", exact=True).select_option("MIND_MAP")
    assert page.get_by_label("版式模板", exact=True).input_value() == "RADIAL_BRANCH"
    assert page.get_by_label("单图风格", exact=True).input_value() == "INHERIT"
    page.get_by_text("查看策划", exact=True).click()
    assert page.locator(".visual-director-blocks textarea").count() >= 2
    page.get_by_role("button", name="添加参考图", exact=True).click()
    page.get_by_role("button", name=re.compile(r"旧正文火箭图")).click()
    page.get_by_label("参考方式", exact=True).select_option("COLOR_LAYOUT")
    page.get_by_role("button", name="图文信息图", exact=True).click()
    page.locator(".visual-generate-controls select").select_option("3:4")
    portrait_preview = page.locator(".visual-generated-preview").bounding_box()
    assert portrait_preview and abs(portrait_preview["width"] / portrait_preview["height"] - 0.75) <= 0.04, f"3:4 预览比例错误: {portrait_preview}"
    page.locator(".visual-generate-controls select").select_option("16:9")
    page.get_by_text("高级设置", exact=True).click()
    prompt = page.locator(".visual-prompt-field textarea").first.input_value()
    assert len(prompt) > 100 and "公众号" in prompt and "天链三号01星" in prompt
    assert "思维导图" in prompt and "波普怀旧" in prompt and "参考图只用于参考色彩、排版" in prompt
    assert "主标题：" in prompt and "信息点：" in prompt and "不在图片内生成文字" not in prompt
    assert page.locator(".visual-generate-controls select").input_value() == "16:9"
    page.get_by_role("button", name="生成这一张", exact=True).click()
    page.locator(".visual-generated-preview img").wait_for()
    preview = page.locator(".visual-generated-preview").bounding_box()
    assert preview and preview["width"] >= 420 and preview["height"] >= 240, f"生成结果预览尺寸不足: {preview}"
    assert state["generations"] == 1
    assert state["generation_payloads"][0]["referenceImageIds"] == [BODY_ID]
    page.wait_for_timeout(900)
    page.reload()
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="AI 生图", exact=True).click()
    page.locator(".visual-generated-preview img").wait_for()
    assert page.get_by_label("项目默认风格").input_value() == "RETRO_POP"
    assert page.get_by_label("视觉结构", exact=True).input_value() == "MIND_MAP"
    page.screenshot(path=ARTIFACTS / "visual-generated-preview.png", full_page=True)
    page.get_by_role("button", name=re.compile(r"正文插图 2")).click()
    page.get_by_text("高级设置", exact=True).click()
    body_prompt = page.locator(".visual-prompt-field textarea").first.input_value()
    page.locator(".visual-prompt-field textarea").first.fill(body_prompt + " 保持主体在画面中心。")
    page.wait_for_timeout(1200)
    assert "正文插图 2" in page.locator(".visual-task-head h3").inner_text(), "自动保存后当前配图项被重置"
    assert_no_overflow(page, "1440px 配图工作台")
    page.screenshot(path=ARTIFACTS / "visual-workspace-desktop.png", full_page=True)

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(150)
    assert_no_overflow(page, "390px 配图工作台")
    mobile_channel_nav = page.locator(".channel-workbench-nav").bounding_box()
    assert mobile_channel_nav and mobile_channel_nav["height"] <= 104, f"移动端渠道导航过高: {mobile_channel_nav}"
    assert page.locator(".channel-platform-tabs").evaluate("element => element.scrollWidth <= element.clientWidth"), "390px 渠道栏仍需横向滚动"
    page.screenshot(path=ARTIFACTS / "visual-workspace-mobile.png", full_page=True)
    assert not state["unexpected"], state["unexpected"]
    assert not state["console_errors"], state["console_errors"]
    browser.close()
