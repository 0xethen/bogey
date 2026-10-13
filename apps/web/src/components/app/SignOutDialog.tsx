import { Link } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  createAlertDialogHandle,
} from "@bogey/ui/components/alert-dialog";
import { useT } from "#/lib/translate.tsx";

export const signOutDialog = createAlertDialogHandle();

export function SignOutDialog() {
  const t = useT();
  return (
    <AlertDialog handle={signOutDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("signOut.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("signOut.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => signOutDialog.close()}
            render={<Link to="/auth/logout" />}
            nativeButton={false}
          >
            {t("signOut.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
