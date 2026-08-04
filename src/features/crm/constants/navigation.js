import { CalendarClock, ContactRound, LayoutDashboard, Settings, WalletCards } from 'lucide-react';

export const CRM_NAV_ITEMS = [
  { label: 'الرئيسية', href: '/apps/crm', icon: LayoutDashboard, end: true },
  { label: 'العملاء المحتملون', href: '/apps/crm/leads', icon: ContactRound },
  { label: 'متابعات اليوم', href: '/apps/crm/followups', icon: CalendarClock },
  { label: 'طلبات التقسيط', href: '/apps/crm/installments', icon: WalletCards },
  { label: 'الإعدادات', href: '/apps/crm/settings', icon: Settings },
];

export const CRM_SECTIONS = {
  leads: { title: 'العملاء المحتملون', description: 'ستظهر هنا قائمة العملاء المحتملين وبيانات التواصل الخاصة بهم.', icon: ContactRound },
  followups: { title: 'متابعات اليوم', description: 'ستظهر هنا المتابعات المجدولة لموظفي المبيعات خلال اليوم.', icon: CalendarClock },
  installments: { title: 'طلبات التقسيط', description: 'ستظهر هنا طلبات التقسيط وحالتها لدى شركات التمويل.', icon: WalletCards },
  settings: { title: 'إعدادات التطبيق', description: 'ستتوفر هنا إعدادات مصادر العملاء وفرق المبيعات والتمويل.', icon: Settings },
};
