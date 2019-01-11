import GCF, { validateOps } from 'shared/global-config';
import { mergeObject, defineReactive } from 'shared/util';

import api from './mixins/api';

import {
  isSupportTouch,
  isChildInParent,
  insertChildrenIntoSlot
} from 'shared/util';
import { smallChangeArray } from 'shared/constants';
import { installResizeDetection } from 'core/third-party/resize-detector/index';
import { createBar } from 'mode/shared/bar';

import GroupManager from './third-party/SectionManager/GroupManager';

/**
 * This is like a HOC, It extracts the common parts of the
 * native-mode, slide-mode and mix-mode.
 * Each mode must implement the following methods:
 * 1. refreshInternalStatus : use to refresh the component
 * 2. destroy : Destroy some registryed events before component destroy.
 * 3. updateBarStateAndEmitEvent: use to update bar states and emit events.
 */

const createComponent = ({ render, components, mixins }) => ({
  name: 'vueScroll',
  props: {
    ops: { type: Object }
  },
  components,
  mixins: [api, ...[].concat(mixins)],
  created() {
    /**
     * Begin to merge options
     */

    const _gfc = mergeObject(this.$vuescrollConfig || {}, {});
    const ops = mergeObject(GCF, _gfc);

    this.$options.propsData.ops = this.$options.propsData.ops || {};
    Object.keys(this.$options.propsData.ops).forEach(key => {
      {
        defineReactive(this.mergedOptions, key, this.$options.propsData.ops);
      }
    });
    // from ops to mergedOptions
    mergeObject(ops, this.mergedOptions);

    this._isVuescrollRoot = true;
    this.renderError = validateOps(this.mergedOptions);
  },
  render(h) {
    let vm = this;
    if (vm.renderError) {
      return <div>{[vm.$slots['default']]}</div>;
    }

    // vuescroll data
    const data = {
      style: {
        height: vm.vuescroll.state.height,
        width: vm.vuescroll.state.width,
        padding: 0
      },
      class: '__vuescroll'
    };

    if (!isSupportTouch()) {
      data.on = {
        mouseenter() {
          vm.vuescroll.state.pointerLeave = false;
          vm.updateBarStateAndEmitEvent();
        },
        mouseleave() {
          vm.vuescroll.state.pointerLeave = true;
          vm.hideBar();
        },
        mousemove() /* istanbul ignore next */ {
          vm.vuescroll.state.pointerLeave = false;
          vm.updateBarStateAndEmitEvent();
        }
      };
    } /* istanbul ignore next */ else {
      data.on = {
        touchstart() {
          vm.vuescroll.state.pointerLeave = false;
          vm.updateBarStateAndEmitEvent();
        },
        touchend() {
          vm.vuescroll.state.pointerLeave = true;
          vm.hideBar();
        },
        touchmove() /* istanbul ignore next */ {
          vm.vuescroll.state.pointerLeave = false;
          vm.updateBarStateAndEmitEvent();
        }
      };
    }

    const ch = [render(h, vm), ...createBar(h, vm)];

    const _customContainer = this.$slots['scroll-container'];
    if (_customContainer) {
      return insertChildrenIntoSlot(h, _customContainer, ch, data);
    }

    return <div {...data}>{ch}</div>;
  },
  mounted() {
    if (!this.renderError) {
      this.initVariables();
      this.initWatchOpsChange();
      // Call external merged Api
      this.refreshInternalStatus();

      this.updatedCbs.push(() => {
        this.scrollToAnchor();
        // need to reflow to deal with the
        // latest thing.
        this.updateBarStateAndEmitEvent();
        this.setDomInfo();
      });
    }
  },
  updated() {
    this.updatedCbs.forEach(cb => {
      cb.call(this);
    });
    // Clear
    this.updatedCbs = [];
  },
  beforeDestroy() {
    // remove registryed resize event
    if (this.destroyParentDomResize) {
      this.destroyParentDomResize();
      this.destroyParentDomResize = null;
    }

    if (this.destroy) {
      this.destroy();
    }
  },

  /** ------------------------------- Computed ----------------------------- */
  computed: {
    scrollPanelElm() {
      return this.$refs['scrollPanel']._isVue
        ? this.$refs['scrollPanel'].$el
        : this.$refs['scrollPanel'];
    }
  },
  data() {
    return {
      vuescroll: {
        state: {
          isDragging: false,
          pointerLeave: true,
          /** Default sizeStrategies */
          height: '100%',
          width: '100%',
          /** How many times you have scrolled */
          scrollingTimes: 0,
          // current size strategy
          currentSizeStrategy: 'percent',
          currentViewDom: [],
          virtualWidth: 0,
          virtualHeight: 0
        }
      },
      bar: {
        vBar: {
          state: {
            posValue: 0,
            size: 0,
            opacity: 0
          }
        },
        hBar: {
          state: {
            posValue: 0,
            size: 0,
            opacity: 0
          }
        }
      },
      mergedOptions: {
        vuescroll: {},
        scrollPanel: {},
        scrollContent: {},
        rail: {},
        bar: {}
      },
      updatedCbs: [],
      renderError: false,
      hasCalculatedVirtualDomSizeAndPos: false
    };
  },
  /** ------------------------------- Methods -------------------------------- */
  methods: {
    /** ------------------------ Handlers --------------------------- */

    scrollingComplete() {
      this.vuescroll.state.scrollingTimes++;
      this.updateBarStateAndEmitEvent('handle-scroll-complete');
    },
    setBarDrag(val) {
      /* istanbul ignore next */
      this.vuescroll.state.isDragging = val;
    },

    /** ------------------------ Some Helpers --------------------------- */

    /*
     * To have a good ux, instead of hiding bar immediately, we hide bar
     * after some seconds by using this simple debounce-hidebar method.
     */
    showAndDefferedHideBar(forceHideBar) {
      this.showBar();

      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = 0;
      }

      this.timeoutId = setTimeout(() => {
        this.timeoutId = 0;
        this.hideBar(forceHideBar);
      }, this.mergedOptions.bar.showDelay);
    },
    showBar() {
      const opacity = this.mergedOptions.bar.opacity;
      this.bar.vBar.state.opacity = opacity;
      this.bar.hBar.state.opacity = opacity;
    },
    hideBar(forceHideBar) {
      // when in non-native mode dragging content
      // in slide mode, just return
      /* istanbul ignore next */
      if (this.vuescroll.state.isDragging) {
        return;
      }

      if (forceHideBar && !this.mergedOptions.bar.keepShow) {
        this.bar.hBar.state.opacity = 0;
        this.bar.vBar.state.opacity = 0;
      }

      // add isDragging condition
      // to prevent from hiding bar while dragging the bar
      if (
        !this.mergedOptions.bar.keepShow &&
        !this.vuescroll.state.isDragging &&
        this.vuescroll.state.pointerLeave
      ) {
        this.bar.vBar.state.opacity = 0;
        this.bar.hBar.state.opacity = 0;
      }
    },
    useNumbericSize() {
      this.usePercentSize();
      setTimeout(() => {
        this.vuescroll.state.currentSizeStrategy = 'number';

        const el = this.$el;
        this.vuescroll.state.height = el.offsetHeight + 'px';
        this.vuescroll.state.width = el.offsetWidth + 'px';
      }, 0);
    },
    usePercentSize() {
      this.vuescroll.state.currentSizeStrategy = 'percent';

      this.vuescroll.state.height = '100%';
      this.vuescroll.state.width = '100%';
    },
    // Set its size to be equal to its parentNode
    setVsSize() {
      if (this.destroyParentDomResize) {
        this.destroyParentDomResize();
        this.destroyParentDomResize = null;
      }

      if (this.mergedOptions.vuescroll.sizeStrategy == 'number') {
        this.useNumbericSize();
        this.registryParentResize();
      } else if (this.mergedOptions.vuescroll.sizeStrategy == 'percent') {
        this.usePercentSize();
      }
    },

    /** ------------------------ Init --------------------------- */
    initWatchOpsChange() {
      const watchOpts = {
        deep: true,
        sync: true
      };
      this.$watch(
        'mergedOptions',
        () => {
          setTimeout(() => {
            if (this.isSmallChangeThisTick) {
              this.isSmallChangeThisTick = false;
              this.updateBarStateAndEmitEvent('options-change');
              return;
            }
            this.refreshInternalStatus();
          }, 0);
        },
        watchOpts
      );

      /**
       * We also watch `small` changes, and when small changes happen, we send
       * a signal to vuescroll, to tell it:
       * 1. we don't need to registry resize
       * 2. we don't need to registry scroller.
       */
      smallChangeArray.forEach(opts => {
        this.$watch(
          opts,
          () => {
            this.isSmallChangeThisTick = true;
          },
          watchOpts
        );
      });
    },
    // scrollTo hash-anchor while mounted component have mounted.
    scrollToAnchor() /* istanbul ignore next */ {
      const validateHashSelector = function(hash) {
        return /^#[a-zA-Z_]\d*$/.test(hash);
      };

      let hash = window.location.hash;
      if (
        !hash ||
        ((hash = hash.slice(hash.lastIndexOf('#'))) &&
          !validateHashSelector(hash))
      ) {
        return;
      }

      const elm = document.querySelector(hash);
      if (
        !isChildInParent(elm, this.$el) ||
        this.mergedOptions.scrollPanel.initialScrollY ||
        this.mergedOptions.scrollPanel.initialScrollX
      ) {
        return;
      }

      this.scrollIntoView(elm);
    },

    /** ------------------------ Registry Resize --------------------------- */

    registryParentResize() {
      const resizeEnable = this.mergedOptions.vuescroll.detectResize;
      this.destroyParentDomResize = resizeEnable
        ? installResizeDetection(this.$el.parentNode, this.useNumbericSize)
        : () => {};
    },

    setDomInfo(force) {
      if (!this.mergedOptions.vuescroll.enableVirtual) {
        this.groupManager = null;
        return;
      }
      this.vuescroll.state.currentViewDom = [];
      this.hasCalculatedVirtualDomSizeAndPos = false;

      setTimeout(() => {
        if (!this.groupManager || force) {
          const children = this.getChildren();
          const { left: l, top: t } = this.$el.getBoundingClientRect();
          const group = [];
          let slotIndex = 0;
          children.forEach(child => {
            if (!child.isResizeElm) {
              const { left, top } = child.getBoundingClientRect();
              group.push({
                x: left - l,
                y: top - t,
                height: child.offsetHeight,
                width: child.offsetWidth,
                index: slotIndex++
              });
            }
          });

          this.groupManager = new GroupManager(group, 100 /* section size */);
          this.vuescroll.state.virtualHeight = this.contentElm.scrollHeight;
          this.vuescroll.state.virtualWidth = this.contentElm.scrollWidth;
          this.hasCalculatedVirtualDomSizeAndPos = true;
          this.setCurrentViewDom();
        }
      }, 0);
    },
    setCurrentViewDom() {
      if (!this.groupManager) return;

      const { scrollLeft, scrollTop } = this.getPosition();
      const { clientWidth, clientHeight } = this.$el;

      this.vuescroll.state.currentViewDom = this.groupManager.getCellIndices({
        x: scrollLeft,
        y: scrollTop,
        width: clientWidth,
        height: clientHeight
      });

      console.log(this.vuescroll.state.currentViewDom);
    },
    getChildren() {
      return Array.from(this.contentElm.children);
    }
  }
});

export default createComponent;
