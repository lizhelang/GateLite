import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "./auth";
import { LanguageProvider } from "./i18n";
import { ThemeProvider } from "./theme";
import "./styles.css";

declare const __GATELITE_BUILD_ID__: string;

document.documentElement.dataset.gateliteBuild = __GATELITE_BUILD_ID__;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </LanguageProvider>
  </React.StrictMode>
);
