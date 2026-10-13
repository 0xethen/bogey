import { brand } from "@bogey/config";

export function BrandMark() {
  if (!brand.icons) return null;
  const { default: light, dark } = brand.icons;
  if (!dark) return <img src={light} alt="" className="size-8" />;
  return (
    <>
      <img src={light} alt="" className="size-8 dark:hidden" />
      <img src={dark} alt="" className="hidden size-8 dark:block" />
    </>
  );
}
