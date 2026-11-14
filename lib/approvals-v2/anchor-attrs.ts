import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Fragment, Slice, type Node } from '@tiptap/pm/model';

export const AnchorAttrs = Extension.create({
  name: 'approvalAnchorAttrs',
  addGlobalAttributes() {
    return [{
      types: ['heading', 'paragraph', 'bulletList', 'orderedList', 'blockquote', 'table', 'image', 'horizontalRule'],
      attributes: Object.fromEntries(['blockId', 'sectionId'].map(name => [name, {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute(name === 'blockId' ? 'data-block-id' : 'data-section-id'),
        renderHTML: (attrs: Record<string, unknown>) => attrs[name] ? { [name === 'blockId' ? 'data-block-id' : 'data-section-id']: attrs[name] } : {},
      }])),
    }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        transformPasted(slice) {
          function strip(fragment: Fragment): Fragment {
            const nodes: Node[] = [];
            fragment.forEach(node => {
              nodes.push(node.isText ? node : node.type.create({ ...node.attrs, blockId: null, sectionId: null }, strip(node.content), node.marks));
            });
            return Fragment.fromArray(nodes);
          }
          return new Slice(strip(slice.content), slice.openStart, slice.openEnd);
        },
      },
    })];
  },
});
