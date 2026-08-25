declare module 'file-icons-js' {
  export interface IconInfo {
    className: string
    color?: string
  }

  /**
   * Get the icon class for a given filename
   * @param filename - The name of the file or folder
   * @returns The icon class name
   */
  export function getClass(filename: string): string

  /**
   * Get the icon class and color for a given filename
   * @param filename - The name of the file or folder
   * @returns An object containing the className and color
   */
  export function getClassWithColor(filename: string): IconInfo
}

