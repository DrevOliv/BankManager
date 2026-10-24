import {
  ArrowLeftRight, Baby, Banknote, Book, Briefcase, Bus, Car, CircleHelp, CirclePlus, Coffee, Dumbbell, Film, Fuel, Gamepad2, Gift,
  GraduationCap, HandCoins, HeartPulse, House, Music, PawPrint, PiggyBank, Plane, Receipt, Repeat, Send, Shapes, Shirt, ShoppingBag,
  ShoppingCart, Smartphone, Sparkles, Tag, Ticket, Utensils, Wifi, Wine, Zap, Landmark, Coins, type LucideIcon,
} from 'lucide-react';

export const ICONS: Record<string, LucideIcon> = {
  'shopping-cart': ShoppingCart,
  utensils: Utensils,
  coffee: Coffee,
  wine: Wine,
  bus: Bus,
  car: Car,
  fuel: Fuel,
  house: House,
  home: House,
  zap: Zap,
  wifi: Wifi,
  smartphone: Smartphone,
  'shopping-bag': ShoppingBag,
  shirt: Shirt,
  repeat: Repeat,
  receipt: Receipt,
  ticket: Ticket,
  'gamepad-2': Gamepad2,
  film: Film,
  music: Music,
  book: Book,
  'graduation-cap': GraduationCap,
  'heart-pulse': HeartPulse,
  dumbbell: Dumbbell,
  plane: Plane,
  banknote: Banknote,
  send: Send,
  gift: Gift,
  baby: Baby,
  'paw-print': PawPrint,
  sparkles: Sparkles,
  shapes: Shapes,
  tag: Tag,
  briefcase: Briefcase,
  'hand-coins': HandCoins,
  'circle-plus': CirclePlus,
  coins: Coins,
  'piggy-bank': PiggyBank,
  landmark: Landmark,
  'arrow-left-right': ArrowLeftRight,
  'circle-help': CircleHelp,
};

export const ICON_CHOICES = Object.keys(ICONS).filter((k) => k !== 'home' && k !== 'circle-help');

/** A soft tinted circle with the category's icon; identity comes from icon + name, not colour alone. */
export function CategoryIcon({ icon, color, size = 36 }: { icon: string | null | undefined; color?: string | null; size?: number }) {
  const Icon = ICONS[icon ?? ''] ?? CircleHelp;
  const c = color ?? '#898781';
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${c} 15%, transparent)`, color: `color-mix(in srgb, ${c} 80%, var(--ink))` }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.46)} strokeWidth={2} />
    </span>
  );
}
