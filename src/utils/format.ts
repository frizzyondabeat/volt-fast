import prettier from 'prettier';

export async function formatCode(
  code: string,
  parser: string = 'babel'
): Promise<string> {
  return await prettier.format(code, { parser });
}
