// Applies a saved theme choice before first paint, so the page does not flash
// the other theme. With no saved choice the page follows the system setting.
;(function () {
  try {
    var saved = localStorage.getItem("theme")
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved)
    }
  } catch (error) {
    // Storage can be blocked. The page then simply follows the system.
  }
})()
