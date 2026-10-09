/** Theme constants shared by the root layout (server) and the theme control (client). */
export const THEME_KEY = "lumoras-theme";

/** Browser chrome colours: the Voice Core page background in each theme. */
export const THEME_COLORS = { light: "#F3F6F8", dark: "#06070B" } as const;

/** Inline script for <head>: applies the saved Light/Dark choice before first paint (Auto = no attribute). */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute('content',t==='light'?'${THEME_COLORS.light}':'${THEME_COLORS.dark}')});}}catch(e){}})();`;
