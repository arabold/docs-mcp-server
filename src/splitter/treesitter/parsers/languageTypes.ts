/**
 * Shared Tree-sitter language type definitions to avoid use of `any`.
 * Mirrors the shape exposed by individual grammar packages like
 * `tree-sitter-javascript` and `tree-sitter-typescript`.
 */

export type BaseNode = {
  type: string;
  named: boolean;
};

export type ChildNode = {
  multiple: boolean;
  required: boolean;
  types: BaseNode[];
};

export type NodeInfo =
  | (BaseNode & {
      subtypes: BaseNode[];
    })
  | (BaseNode & {
      fields: { [name: string]: ChildNode };
      children: ChildNode[];
    });

/**
 * Canonical language object interface exported by grammar packages.
 * We only need it structurally for stronger typing when calling parser.setLanguage().
 */
export interface TreeSitterLanguage {
  name: string;
  language: unknown;
  nodeTypeInfo: NodeInfo[];
}
