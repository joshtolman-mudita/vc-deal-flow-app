"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  Building2, 
  Users,
  FileSearch,
  Settings,
  PanelLeftClose
} from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Deals", href: "/deals", icon: Building2 },
  { name: "Partners", href: "/partners", icon: Users },
  { name: "Diligence", href: "/diligence", icon: FileSearch },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function Sidebar({ onHide }: { onHide?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen w-64 flex-col bg-black text-white">
      <div className="flex h-auto flex-col border-b border-yellow-400/20 px-4 py-4">
        <div className="mb-1 flex w-full justify-end">
          <button
            onClick={onHide}
            className="rounded p-1 text-gray-300 hover:bg-gray-800 hover:text-yellow-400"
            title="Hide menu"
            aria-label="Hide menu"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col items-center justify-center">
        <img 
          src="/images/mudita-logo.png" 
          alt="Mudita Venture Partners" 
          className="w-full px-2 mb-3"
        />
        <p className="text-[9px] text-yellow-400 tracking-[0.2em] uppercase font-semibold">Deal Flow Platform</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-yellow-400 text-black shadow-lg"
                  : "text-gray-300 hover:bg-gray-800 hover:text-yellow-400"
              }`}
            >
              <Icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-yellow-400/20 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-400">
            <span className="text-sm font-bold text-black">MV</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              Mudita Ventures
            </p>
            <p className="text-xs text-gray-400 truncate">
              Internal Tool
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}



