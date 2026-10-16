export interface Device {
  browser: string | null;
  os: string | null;
  mobile: boolean;
}

const BROWSERS: Tuple<[RegExp, string]> = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: Tuple<[RegExp, string]> = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

// a rough browser and system from a user agent, for listing someone's signed-in devices
export function describeUserAgent(agent: string | null | undefined): Device {
  const text = agent ?? "";
  return {
    browser: BROWSERS.find(([pattern]) => pattern.test(text))?.[1] ?? null,
    os: SYSTEMS.find(([pattern]) => pattern.test(text))?.[1] ?? null,
    mobile: /Mobi|iPhone|Android/.test(text),
  };
}
