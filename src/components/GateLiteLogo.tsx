import { cn } from "@/lib/utils";

type GateLiteLogoVariant = "icon" | "horizontal";

interface GateLiteLogoProps {
  variant?: GateLiteLogoVariant;
  alt?: string;
  className?: string;
  imageClassName?: string;
}

export function GateLiteLogo({ variant = "icon", alt = "GateLite", className, imageClassName }: GateLiteLogoProps) {
  const lightSrc = `/brand/gatelite/${variant}-light.svg`;
  const darkSrc = `/brand/gatelite/${variant}-dark.svg`;

  return (
    <span className={cn("inline-flex shrink-0 items-center", className)}>
      <img src={lightSrc} alt={alt} draggable={false} className={cn("block dark:hidden", imageClassName)} />
      <img src={darkSrc} alt={alt} draggable={false} className={cn("hidden dark:block", imageClassName)} />
    </span>
  );
}
