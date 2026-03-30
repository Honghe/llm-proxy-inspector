import { createBrowserRouter, Navigate } from "react-router-dom";

import { RecordRedirectPage } from "../pages/record-redirect/RecordRedirectPage";
import { SessionsPage } from "../pages/sessions/SessionsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <SessionsPage />,
  },
  {
    path: "/sessions/:sessionId",
    element: <SessionsPage />,
  },
  {
    path: "/ids/:recordId",
    element: <RecordRedirectPage />,
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
