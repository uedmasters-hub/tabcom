import React from "react";
import ReactDOM from "react-dom/client";

import App from "../../src/app/App";

import "../../src/styles/tailwind.css";
import "../../src/styles/globals.css";

ReactDOM.createRoot(
  document.getElementById("root")!
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);