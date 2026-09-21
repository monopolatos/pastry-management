import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { applyCustomTheme, readCustomTheme } from "./lib/customTheme";
import { I18nProvider } from "./lib/i18n";
import "./index.css";

// Applied synchronously, before the first render, so a previously-saved custom color scheme is
// visible immediately rather than flashing the default colors first.
applyCustomTheme(readCustomTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <I18nProvider>
        <TooltipProvider delayDuration={0}>
          <App />
          <Toaster />
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
