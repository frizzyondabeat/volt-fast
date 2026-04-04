export type FilenameConvention =
  | 'KEBAB_CASE'
  | 'PASCAL_CASE'
  | 'CAMEL_CASE'
  | 'SNAKE_CASE';

export type HuskySettings = {
  enablePreCommit: boolean;
  enablePrePush: boolean;
  runFormatOnCommit: boolean;
  runTestsOnCommit: boolean;
  runBuildOnPush: boolean;
  testRunner: 'vitest' | 'jest' | 'cypress' | null;
};

export type GeneratorSettings = {
  tailwind?: { cssPath?: string | null };
  husky?: HuskySettings;
  filenameConvention?: FilenameConvention;
};

export type GeneratorOptions = {
  enabledTools: string[];
  detectedTools: string[];
  settings: GeneratorSettings;
  packageManager: string;
  projectDir: string;
};

export type GeneratorFunction = (
  options: GeneratorOptions
) => Promise<[string, string][]>;
