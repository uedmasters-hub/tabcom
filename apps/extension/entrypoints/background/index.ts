export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    await browser.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    });
  });
});
