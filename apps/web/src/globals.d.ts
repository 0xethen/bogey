declare const __BOGEY_MIGRATIONS__: string[];

declare const __BOGEY_VERSION__: string;
declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
