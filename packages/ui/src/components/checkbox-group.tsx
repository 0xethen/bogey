import { CheckboxGroup as CheckboxGroupPrimitive } from "@base-ui/react/checkbox-group";
import { cn } from "@bogey/ui/lib/utils";

function CheckboxGroup({ className, ...props }: CheckboxGroupPrimitive.Props) {
  return (
    <CheckboxGroupPrimitive
      data-slot="checkbox-group"
      className={cn("flex flex-col gap-3", className)}
      {...props}
    />
  );
}

export { CheckboxGroup };
