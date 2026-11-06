export const plugins = [
  {
    type: 'patchwork:datatype',
    id: 'folder',
    name: 'Folder',
    icon: 'Folder',
    async load() {
      const { FolderDatatype } = await import('./datatype.js');
      return FolderDatatype;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'directory',
    name: 'Directory',
    icon: 'Folder',
    unlisted: true,
    async load() {
      const { DirectoryDatatype } = await import('./datatype.js');
      return DirectoryDatatype;
    },
  },
  {
    type: 'patchwork:children',
    id: 'folder-children',
    name: 'Folder children',
    datatypes: ['folder'],
    async load() {
      const { folderChildren } = await import('./children.js');
      return folderChildren;
    },
  },
  {
    type: 'patchwork:children',
    id: 'directory-children',
    name: 'Directory children',
    datatypes: ['directory'],
    async load() {
      const { directoryChildren } = await import('./children.js');
      return directoryChildren;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'folder-viewer',
    name: 'Folder Viewer',
    supportedDatatypes: ['folder', 'directory'],
    async load() {
      const { FolderTool } = await import('./tool.js');
      return FolderTool;
    },
  }
];
