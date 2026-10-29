/** Live Text nodes behind `nodeRef`s (PLAN.md §7.1). Weak, so removed nodes can be collected. */
export class NodeRegistry {
  private next = 1;
  private readonly refs = new Map<number, WeakRef<Text>>();
  private readonly ids = new WeakMap<Text, number>();

  ref(node: Text): number {
    const existing = this.ids.get(node);
    if (existing !== undefined) return existing;
    const id = this.next++;
    this.refs.set(id, new WeakRef(node));
    this.ids.set(node, id);
    return id;
  }

  get(ref: number): Text | undefined {
    const n = this.refs.get(ref)?.deref();
    return n?.isConnected ? n : undefined;
  }

  refOf(node: Node): number | undefined {
    return node.nodeType === Node.TEXT_NODE ? this.ids.get(node as Text) : undefined;
  }

  /** True when every registered node is still in the document. */
  allConnected(): boolean {
    for (const r of this.refs.values()) if (!r.deref()?.isConnected) return false;
    return true;
  }

  get size(): number {
    return this.refs.size;
  }
}
