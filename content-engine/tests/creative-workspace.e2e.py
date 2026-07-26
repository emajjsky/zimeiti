from datetime import datetime
import os
from pathlib import Path

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

    assert page.locator(".creative-stepper button").count() == 5
    assert page.locator(".creative-skill-fields select").count() == 5
    assert page.get_by_role("button", name="配图").is_disabled()
    assert page.get_by_role("button", name="排版").is_disabled()
    assert page.get_by_role("button", name="审核").is_disabled()
    assert page.get_by_text("视频号", exact=True).count() == 0

    target = page.get_by_label("目标受众")
    target.fill("想提高内容效率但不熟悉技术的普通创作者")
    with page.expect_response(lambda response: "/creative/projects/" in response.url and response.request.method == "PUT" and response.status == 200):
        page.get_by_role("button", name="保存设定").click()
    page.get_by_text("已保存", exact=False).wait_for()
    assert "view=create" in page.url
    assert "project=" in page.url
    page.screenshot(path=ARTIFACTS / "creative-brief-desktop.png", full_page=True)

    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_selector(".creative-brief-form")
    assert page.get_by_label("目标受众").input_value() == "想提高内容效率但不熟悉技术的普通创作者"

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(350)
    page.screenshot(path=ARTIFACTS / "creative-brief-mobile.png", full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    assert page.locator(".sidebar").bounding_box()["x"] < 0

    page.set_viewport_size({"width": 1440, "height": 1000})
    page.wait_for_timeout(350)
    page.get_by_role("button", name="今天", exact=True).click()
    page.wait_for_selector(".today-layout")
    current = datetime.now()
    assert page.get_by_role("heading", name=f"今天，{current.month} 月 {current.day} 日").count() == 1
    assert page.get_by_text("完善创作设定：普通人如何判断一个 AI 工具是否值得使用", exact=True).count() == 1
    assert page.get_by_text("今天，7 月 22 日", exact=True).count() == 0
    assert page.get_by_text("审核小红书 8 页图文", exact=True).count() == 0
    page.screenshot(path=ARTIFACTS / "today-real-data.png", full_page=True)
    assert not console_errors, console_errors
    browser.close()
