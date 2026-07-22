import { useRef } from "react";
import type { KeyboardEvent, ReactNode, RefCallback } from "react";

export interface SidebarTabItem {
  id: string;
  label: string;
  badge?: number;
}

interface SidebarTabsProps {
  ariaLabel: string;
  tabs: SidebarTabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

/**
 * 侧栏分页标签条。遵循 ARIA Tabs 模式（自动激活）：
 * 方向键/Home/End 在标签间移动并立即切换，活动标签进入 Tab 序。
 */
export function SidebarTabs({ ariaLabel, tabs, activeTab, onChange }: SidebarTabsProps) {
  const tabElements = useRef(new Map<string, HTMLButtonElement>());

  const registerTab = (tabId: string): RefCallback<HTMLButtonElement> => (element) => {
    if (element) tabElements.current.set(tabId, element);
    else tabElements.current.delete(tabId);
  };

  const activateTab = (tabId: string) => {
    onChange(tabId);
    tabElements.current.get(tabId)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    activateTab(tabs[nextIndex].id);
  };

  return (
    <div className="sidebar-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          className="sidebar-tab"
          aria-selected={tab.id === activeTab}
          aria-controls={`page-${tab.id}`}
          tabIndex={tab.id === activeTab ? 0 : -1}
          ref={registerTab(tab.id)}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className="tab-badge" aria-label={`${tab.badge} 条`}>{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

interface SidebarPageProps {
  tabId: string;
  activeTab: string;
  children: ReactNode;
}

/**
 * 分页内容面板。非活动页保持挂载但 hidden，
 * 以保留面板内部状态（部件树折叠、输入草稿等）。
 */
export function SidebarPage({ tabId, activeTab, children }: SidebarPageProps) {
  return (
    <div
      role="tabpanel"
      id={`page-${tabId}`}
      aria-labelledby={`tab-${tabId}`}
      className="sidebar-page"
      hidden={tabId !== activeTab}
    >
      {children}
    </div>
  );
}
