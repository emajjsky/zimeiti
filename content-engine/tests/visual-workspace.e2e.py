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
            "coreMessage": "新一代中继卫星将提升航天器测控与数据传输能力", "targetPlatforms": ["WECHAT"],
            "timing": "TODAY", "sourceRequirements": "使用公开资料", "constraints": "不夸大技术能力",
        },
        "planningVersion": 1,
        "coreViewpoint": "中继卫星是航天器与地面之间的重要通信桥梁。",
        "factChecks": [],
        "versions": [{"id": "version-1", "platform": "WECHAT", "title": "我国成功发射天链三号01星", "body": body, "status": "PREFLIGHT_PASSED", "updatedAt": NOW}],
        "sourceSnapshot": {},
        "delivery": {"platforms": {"WECHAT": {"stage": "VISUAL", "visual": None, "review": None}}},
        "createdAt": NOW,
        "updatedAt": NOW,
    }


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, **({"executable_path": chrome_path()} if chrome_path() else {}))
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    state = {"project": project(), "searches": [], "visual_writes": 0, "unexpected": [], "console_errors": []}
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
            return respond(route, {"inputs": [], "references": []})
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
    page.get_by_text(re.compile(r"已规划 [3-5] 张")).wait_for()
    page.get_by_role("button", name=re.compile(r"文章封面")).wait_for()
    page.get_by_role("button", name=re.compile(r"正文插图 1")).wait_for()
    page.get_by_role("button", name=re.compile(r"天链三号01星")).first.wait_for()
    page.get_by_text("Satellite launch", exact=True).wait_for()
    assert state["searches"], "进入配图页后没有自动搜索第一组关键词"
    for _ in range(20):
        if state["visual_writes"]:
            break
        page.wait_for_timeout(100)
    assert state["visual_writes"] >= 1, "自动生成的配图方案没有保存"
    page.get_by_role("button", name="AI 生图", exact=True).click()
    prompt = page.locator(".visual-prompt-field textarea").input_value()
    assert len(prompt) > 100 and "公众号" in prompt and "天链三号01星" in prompt
    assert page.locator(".visual-generate-controls select").input_value() == "16:9"
    page.get_by_role("button", name=re.compile(r"正文插图 2")).click()
    body_prompt = page.locator(".visual-prompt-field textarea").input_value()
    page.locator(".visual-prompt-field textarea").fill(body_prompt + " 保持主体在画面中心。")
    page.wait_for_timeout(1200)
    assert "正文插图 2" in page.locator(".visual-task-head h3").inner_text(), "自动保存后当前配图项被重置"
    assert_no_overflow(page, "1440px 配图工作台")
    page.screenshot(path=ARTIFACTS / "visual-workspace-desktop.png", full_page=True)

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(150)
    assert_no_overflow(page, "390px 配图工作台")
    page.screenshot(path=ARTIFACTS / "visual-workspace-mobile.png", full_page=True)
    assert not state["unexpected"], state["unexpected"]
    assert not state["console_errors"], state["console_errors"]
    browser.close()
