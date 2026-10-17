import { Component, type ErrorInfo, type ReactNode } from "react";
import { IconPlugConnectedX } from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { useT } from "#/lib/translate.tsx";

interface Props {
  name: string;
  recover?: ReactNode;
  note?: ReactNode;
  detail?: boolean;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

function Words(props: { k: "ranInto"; name: string } | { k: "restWorks" } | { k: "tryAgain" }) {
  const t = useT();
  if (props.k === "ranInto") return t("plugin.ranInto", { name: props.name });
  return props.k === "restWorks" ? t("plugin.restWorks") : t("error.tryAgain");
}

export class PluginBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[bogey] plugin "${this.props.name}" failed to render:`, error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <>
        <Alert variant="destructive">
          <IconPlugConnectedX />
          <AlertTitle>
            <Words k="ranInto" name={this.props.name} />
          </AlertTitle>
          <AlertDescription>
            <p>
              {this.props.note ?? <Words k="restWorks" />}
              {this.props.detail && ` ${error.message}`}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => this.setState({ error: null })}
            >
              <Words k="tryAgain" />
            </Button>
          </AlertDescription>
        </Alert>
        {this.props.recover}
      </>
    );
  }
}
