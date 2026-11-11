import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth.jsx";
import { FacilityProvider } from "./facility.jsx";
import { ToastProvider } from "./feedback.jsx";
import App from "./App.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FacilityProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </FacilityProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
