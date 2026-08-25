export class MediaGroupBuffer {
  constructor(debounceMs = 500) {
    this.debounceMs = debounceMs;
    this.groups = new Map();
  }

  /**
   * 미디어 그룹 항목을 추가하고, 그룹의 모든 항목이 수신 완료되면 콜백을 실행한다.
   * @param {string} mediaGroupId
   * @param {object} item { msg, attachmentRecord }
   * @param {Function} onComplete callback(items, combinedCaption)
   */
  add(mediaGroupId, item, onComplete) {
    if (!this.groups.has(mediaGroupId)) {
      this.groups.set(mediaGroupId, {
        items: [],
        caption: '',
        timer: null
      });
    }

    const group = this.groups.get(mediaGroupId);
    group.items.push(item);

    if (item.msg.caption) {
      group.caption = item.msg.caption;
    }

    if (group.timer) {
      clearTimeout(group.timer);
    }

    group.timer = setTimeout(() => {
      this.groups.delete(mediaGroupId);
      onComplete(group.items, group.caption);
    }, this.debounceMs);
  }
}

export const mediaGroupBuffer = new MediaGroupBuffer();
