import path from 'node:path'

function isInsideRoot(targetPath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export function resolveAllowedPath(
  inputPath: string | undefined,
  allowedRoots: string[],
  fallbackPath: string,
): string {
  const resolvedPath = path.resolve(inputPath?.trim() || fallbackPath)

  for (const rootPath of allowedRoots) {
    if (isInsideRoot(resolvedPath, rootPath)) {
      return resolvedPath
    }
  }

  throw new Error('Path is outside allowed roots')
}
