export const FolderDatatype = {
  init(doc) {
    doc.title = 'New Folder';
    doc.docs = [];
  },
  getTitle: (doc) => doc.title || 'Unnamed Folder',
  setTitle: (doc, title) => {
    doc.title = title;
  },
};

export const FileDatatype = {
  init: () => {
    throw new Error("Can't create empty File");
  },
  getTitle(doc) {
    return doc.name || 'Unnamed File';
  },
  setTitle(doc, title) {
    doc.name = title;
  },
};
