import type { ParsedPresentation, SlideComment, SlideCommentAnchor, SlideObjectReference } from '@filens/core/presentation-support';

export function commentAnchors({ anchor, additionalAnchors = [] }: SlideComment): readonly SlideCommentAnchor[] {
  return anchor ? [anchor, ...additionalAnchors] : additionalAnchors;
}

export function matchSlideReference<T>(candidates: readonly T[], target: SlideObjectReference,
  getReference: (item: T) => SlideObjectReference | undefined): T | undefined {
  const { id, creationId } = target;
  if (creationId) {
    const exact = candidates.find(candidate => getReference(candidate)?.creationId === creationId);
    if (exact !== undefined) return exact;
  }
  return id ? candidates.find(candidate => {
    const reference = getReference(candidate);
    return reference?.id === id && (!creationId || !reference.creationId);
  }) : undefined;
}

export function slidesWithCommentSources(presentation: ParsedPresentation | null) {
  if (!presentation) return [];
  return presentation.commentSources?.length
    ? [...presentation.slides, ...presentation.commentSources.map(source => source.slide)]
    : presentation.slides;
}
