'use client';

import { useState, useSyncExternalStore } from 'react';
import { PanelLeftClose, PanelLeftOpen, Menu, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Icon } from '@/components/admin/icons';
import styles from './admin.module.css';

type NavItem = { href: string; label: string; icon: string; primary: boolean };

type Props = {
  items: NavItem[];
  userEmail?: string;
  logoutLabel: string;
  toggleLabel: string;
  menuLabel: string;
  signOut: () => Promise<void>;
};

// Preferencia de colapso (desktop): store externo sobre localStorage, leído con
// useSyncExternalStore para no romper la hidratación ni hacer setState en effect.
const STORAGE_KEY = 'bv-sidebar-collapsed';
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

function setCollapsedPref(value: boolean) {
  localStorage.setItem(STORAGE_KEY, String(value));
  listeners.forEach((listener) => listener());
}

export function AdminSidebar({
  items,
  userEmail,
  logoutLabel,
  toggleLabel,
  menuLabel,
  signOut,
}: Props) {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const [menuOpen, setMenuOpen] = useState(false);
  const secondary = items.filter((item) => !item.primary);

  return (
    <aside className={styles.sidebar} data-collapsed={collapsed}>
      <div className={styles.brandRow}>
        <span className={`${styles.brand} ${styles.brandFull}`}>Boka Verde</span>
        <span className={`${styles.brand} ${styles.brandMark}`}>BV</span>
        <button
          type="button"
          onClick={() => setCollapsedPref(!collapsed)}
          className={styles.toggleBtn}
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          title={toggleLabel}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className={styles.nav}>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            data-primary={item.primary}
            className={styles.navLink}
            title={item.label}
            aria-label={item.label}
          >
            <span className={styles.navIcon}>
              <Icon name={item.icon} size={19} />
            </span>
            <span className={styles.navLabel}>{item.label}</span>
          </Link>
        ))}
      </nav>

      <button
        type="button"
        className={styles.hamburgerBtn}
        onClick={() => setMenuOpen((open) => !open)}
        aria-label={menuLabel}
        aria-expanded={menuOpen}
      >
        {menuOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      <div className={styles.mobileMenu} data-open={menuOpen}>
        {secondary.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={styles.mobileMenuLink}
            onClick={() => setMenuOpen(false)}
          >
            <Icon name={item.icon} size={20} />
            {item.label}
          </Link>
        ))}
        {userEmail && <p className={styles.mobileEmail}>{userEmail}</p>}
        <form action={signOut}>
          <button type="submit" className={styles.mobileMenuLink}>
            <Icon name="logout" size={20} />
            {logoutLabel}
          </button>
        </form>
      </div>

      <div className={styles.footer}>
        {userEmail && <p className={styles.userEmail}>{userEmail}</p>}
        <form action={signOut}>
          <button
            type="submit"
            className={styles.logoutBtn}
            title={logoutLabel}
            aria-label={logoutLabel}
          >
            <Icon name="logout" size={17} />
            <span className={styles.logoutLabel}>{logoutLabel}</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
