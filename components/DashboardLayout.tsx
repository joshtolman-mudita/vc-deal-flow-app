"use client";

import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";
import VersionFooter from "./VersionFooter";

const SIDEBAR_HIDDEN_STORAGE_KEY = "dashboardSidebarHidden";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY);
      if (stored !== null) {
        setIsSidebarHidden(stored === "true");
      }
    } catch (error) {
      console.warn("Unable to read sidebar preference:", error);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, String(isSidebarHidden));
    } catch (error) {
      console.warn("Unable to persist sidebar preference:", error);
    }
  }, [isSidebarHidden]);

  const toggleSidebarVisibility = () => {
    setIsSidebarHidden((prev) => !prev);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {!isSidebarHidden && <Sidebar onHide={toggleSidebarVisibility} />}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header isSidebarHidden={isSidebarHidden} onToggleSidebar={toggleSidebarVisibility} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
        <VersionFooter />
      </div>
    </div>
  );
}



