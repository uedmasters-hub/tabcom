export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async () => {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    });
  });
});