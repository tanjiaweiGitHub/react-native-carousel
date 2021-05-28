import React, {  useEffect, useState, useRef, useMemo } from 'react';
import { Animated, Dimensions } from 'react-native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';

// TODO
// 1. scrollingDisable 为false时, 正在滚动中识别手势会导致跳动
// 2. scrollStepper === nearest, 手势滚动多个item可能会卡在两端不能继续自动滚动

const DEFAULT_SLIDER_WIDTH = Dimensions.get('window').width;
const DEFAULT_ITEM_WIDTH = DEFAULT_SLIDER_WIDTH / 4;
const DEFAULT_SWIPE_THRESHOLD = 20;
const DEFAULT_LOOP_CLONES_PER_SIDE = 2;

const HIT_SLOP = {
  top: 5,
  bottom: 5,
  left: 5,
  right: 5,
};

interface Props {
  data: Array<unknown>,
  initIndex?: number,
  renderItem: any,
  itemWidth?: number,
  sliderWidth?: number,
  itemHeight?: number,
  sliderHeight?: number,
  scrollEnabled?: boolean, // 等于true, 允许手势滑动
  scrollingDisable?: boolean, // 等于true时， 滚动时手势不生效，滚动结束手势生效
  scrollStepper?: 'next' | 'nearest', // next: 下一个, nearest: 手势结束后最近的
  swipeThreshold?: number, // 滑动阈值, 不超过此值， 恢复到原来
  horizontal?: boolean, // 等于true, 水平布局
  loop?: boolean // 等于true, 开启无限循环模式
  loopClonesPerSide?: number, // 无限循环时， 在两端添加的数量, 必须小于数据的长度
  autoplayReverse?: boolean, // 默认false, 向左/上， 为true时反向
  autoplay?: boolean // 等于true, 开启自动播放
  autoplayDuration?: number //  单位毫秒， 滚动一项需要的时间
  autoplayInterval?: number // 单位毫秒, 自动轮播的间歇
  useNativeDriver?: boolean // 等于true, 启用高性能动画
  onBeforeSnapToItem?: ({ item, index }: {item: unknown, index: number}) => void,
  onAfterSnapToItem?: ({ item, index }: {item: unknown, index: number}) => void,
}

export const Carousel: React.FC<Props> = ({
  data: propsData,
  initIndex: initRealIndex = 0,
  renderItem,
  itemWidth = DEFAULT_ITEM_WIDTH,
  sliderWidth = DEFAULT_SLIDER_WIDTH,
  itemHeight = DEFAULT_ITEM_WIDTH,
  sliderHeight = DEFAULT_SLIDER_WIDTH,
  scrollEnabled: propsScrollEnabled = true,
  scrollingDisable = true,
  scrollStepper = 'nearest',
  swipeThreshold = DEFAULT_SWIPE_THRESHOLD,
  horizontal = true,
  loop = true,
  loopClonesPerSide: propsLoopClonesPerSide = DEFAULT_LOOP_CLONES_PER_SIDE,
  autoplay = false,
  autoplayDuration = 500,
  autoplayReverse = false,
  autoplayInterval = 1000,
  useNativeDriver = true,
  onBeforeSnapToItem,
  onAfterSnapToItem,
}: Props) => {
  const [scrollEnabled, setScrollEnabled] = useScrollEnabled(propsScrollEnabled)
  const loopClonesPerSide = useLoopClonesPerSide(propsData, loop, propsLoopClonesPerSide);
  const data = useData(propsData, loop, loopClonesPerSide);
  const initIndex = useInitIndex(initRealIndex, data, loopClonesPerSide);
  const size = useSize(horizontal, itemWidth, itemHeight);
  const containerSpace = useContainerSpace(size, horizontal ? sliderWidth : sliderHeight);
  const listOffset = useListOffset(initIndex, size, containerSpace,);
  const inputRanges = useInputRanges(data, size, containerSpace);
  const positions = usePositions(data, size, containerSpace);
  const distanceAnimated = useDistanceAnimated(listOffset, data);
  const _lastOffset = useRef(0);
  const timer = useRef<number | null>(null);
  const activeIndex = useRef(initIndex);

  useEffect(() => {
    _lastOffset.current = 0;
  }, [data.length])
  useEffect(() => {
    if (initIndex > -1) {
      activeIndex.current = initIndex;
    }
  }, [initIndex, data.length]);
  useEffect(() => {
    if (positions.length > 0 && autoplay) {
      startLoopAnimated();
    }
    return () => {
      stopLoopAnimated();
    };
  }, [positions, autoplay]);

  const onceAnimated = (nextIndex: number, duration?: number) => {
    const realNextIndex = positions[nextIndex] ? nextIndex : activeIndex.current;
    const nextItem = data[realNextIndex];
    let toValue = -positions[realNextIndex]?.start;
    if (onBeforeSnapToItem) {
      onBeforeSnapToItem({ item: nextItem.item, index: nextItem.realIndex });
    }
    distanceAnimated.flattenOffset();
    if (scrollingDisable && propsScrollEnabled) {
      setScrollEnabled(false)
    }
    Animated.timing(distanceAnimated, {
      toValue,
      duration: duration || autoplayDuration,
      useNativeDriver
    }).start(() => {
      if (scrollingDisable && propsScrollEnabled) {
        setScrollEnabled(true)
      }
      if (onAfterSnapToItem) {
        onAfterSnapToItem({ item: nextItem.item, index: nextItem.realIndex });
      }
      activeIndex.current = realNextIndex;

      if (activeIndex.current === (data.length - loopClonesPerSide) && loop) {
        activeIndex.current = loopClonesPerSide;
        toValue = -positions[activeIndex.current].start;
      } else if (activeIndex.current === (loopClonesPerSide - 1) && loop) {
        activeIndex.current = data.length - loopClonesPerSide - 1;
        toValue = -positions[activeIndex.current].start;
      }

      distanceAnimated.setOffset(toValue);
      distanceAnimated.setValue(0);
      startLoopAnimated();
    });
  };

  const startLoopAnimated = () => {
    stopLoopAnimated();
    if (autoplay) {
      timer.current = setTimeout(() => {
        onceAnimated(autoplayReverse ? activeIndex.current - 1 : activeIndex.current + 1);
      }, autoplayInterval);
    }
  };
  const stopLoopAnimated = () => {
    if ( timer.current ) {
      clearTimeout(timer.current);
    }
  };

  const onGestureEvent = useMemo(
    () => (horizontal ? Animated.event(
      [{ nativeEvent: { translationX: distanceAnimated } }],
      { useNativeDriver }
    )
      : Animated.event(
        [{ nativeEvent: { translationY: distanceAnimated } }],
        { useNativeDriver }
      )),
    [horizontal, useNativeDriver]
  );
  const onHandlerStateChange = ({
    nativeEvent: { state, oldState, translationX, translationY }
  }) => {
    if (state === State.BEGAN) {
      stopLoopAnimated();
    }
    if (oldState === State.ACTIVE) {
      const translation = horizontal ? translationX : translationY;
      if (translation === 0) { return null }
      _lastOffset.current += translation;
      const _translation = Math.abs(scrollStepper === 'nearest' ? (translation % size) : translation);
      const moveCount = scrollStepper === 'nearest' ? (Math.floor(translation / size) + (translation > 0 ? 0 : 1)) : 0;
      const nextIndex = activeIndex.current - moveCount + ((swipeThreshold < _translation) ? (translation > 0 ? -1 : 1) : 0);
      const duration = Math.floor(((swipeThreshold < _translation) ? (size - _translation) : _translation) / size * autoplayDuration);
      onceAnimated(nextIndex, duration);
    }
  };
  if (data.length !== inputRanges.length) {
    return null;
  }

  return (
    <PanGestureHandler
      onGestureEvent={onGestureEvent}
      onHandlerStateChange={onHandlerStateChange}
      enabled={scrollEnabled}
      shouldCancelWhenOutside
      hitSlop={HIT_SLOP}
      minDist={0}
    >
      <Animated.View style={[{
        width: sliderWidth,
        height: sliderHeight,
        overflow: 'hidden',
      }, horizontal ? {justifyContent: 'center'} : {alignItems: 'center',}]}
      >
        <Animated.View style={[{
          transform: [horizontal ? { translateX: distanceAnimated } : { translateY: distanceAnimated }],
          flexDirection: horizontal ? 'row' : 'column',
        }]}
        >
          { data.map((item, index) => {
            const animatedValue = Animated.subtract(0, distanceAnimated).interpolate({
              inputRange: inputRanges[index],
              outputRange: [-1, 0, 1],
            });
            return (
              <Animated.View
                style={{ width: itemWidth, height: itemHeight }}
                key={`carousel-${item.carouselId}`}
              >
                { renderItem({ item: item.item, index: item.realIndex }, animatedValue) }
              </Animated.View>
            );
          }) }
        </Animated.View>
      </Animated.View>
    </PanGestureHandler>
  );
};

const useListOffset = (initIndex, size, containerSpace) => {
  const [listOffset, setListOffset] = useState(0);
  useEffect(() => {
    const _listOffset = -initIndex * size + containerSpace;
    setListOffset(_listOffset);
  }, [initIndex, size, containerSpace]);
  return listOffset;
};
const useContainerSpace = (size, containerSize) => {
  const [containerSpace, setContainerSpace] = useState(0);
  useEffect(() => {
    const _containerSpace = (containerSize - size) / 2;
    setContainerSpace(_containerSpace);
  }, [size, containerSize]);
  return containerSpace;
};

const useInitIndex = (initRealIndex, data, loopClonesPerSide) => {
  const [initIndex, setInitIndex] = useState(0);
  useEffect(() => {
    const len = data.length;
    const realLength = len - loopClonesPerSide * 2
    if (realLength !== 0) {
      const _index = initRealIndex  % realLength;
      const _initRealIndex = initRealIndex < 0 ? (realLength + _index) : _index;
      const _initIndex = _initRealIndex + loopClonesPerSide
      setInitIndex(_initIndex);
    }
  }, [data.length, loopClonesPerSide]);
  return initIndex;
};
const useScrollEnabled = (scrollEnabled: boolean): [boolean, (scrollEnabled: boolean)=> void ] => {
  const [enabled, setEnabled] = useState(scrollEnabled);
  useEffect(() => {
    setEnabled(enabled)
  }, [scrollEnabled])
  return [enabled, setEnabled]
}
const useLoopClonesPerSide = (data, loop: boolean, propsLoopClonesPerSide: number ) => {
  const [loopClonesPerSide, setLoopClonesPerSide] = useState(0)
  useEffect(() => {
    const len = data.length;
    if (loop) {
      setLoopClonesPerSide( len > propsLoopClonesPerSide ? propsLoopClonesPerSide : len )
    } else {
      setLoopClonesPerSide(0)
    }
  },[data.length, propsLoopClonesPerSide, loop])
return loopClonesPerSide;
}

const useData = (arr: Array<any> = [], loop: boolean = true, loopClonesPerSide: number): Array<{
  readonly realIndex: number,
  readonly carouselId: string,
  item: unknown
}> => {
  const [data, setData] = useState([]);
  useEffect(() => {
    function _getData(arr) {
      // 暂不考虑 loopClonesPerSide 大于数组长度（正常情况下loopClonesPerSide不会大于数组长度）
      const _data = arr.map((item, index) => ({
        realIndex: index,
        item,
      }));
      if (loop && loopClonesPerSide > 0) {
        const beforeArr = _data.slice(0, loopClonesPerSide);
        const afterArr = _data.slice(-loopClonesPerSide);
        return [...afterArr, ..._data, ...beforeArr];
      }
      return [..._data];
    }
    setData(_getData(arr).map((item, index) => {
      return {
        item: item.item,
        realIndex: item.realIndex,
        carouselId: `carousel-${index}`
      }
    }));
  }, [arr, loop, loopClonesPerSide]);
  return data;
};

const usePositions = (array = [], size: number, containerSpace: number = 0) => {
  const [positions, setPositions] = useState([]);
  useEffect(() => {
    const _positions = [];
    array.forEach((item, index) => {
      const start = index * size - containerSpace;
      _positions[index] = {
        start,
        end: start + size
      };
    });
    setPositions(_positions);
  }, [array.length, size, containerSpace]);
  return positions;
};
const useDistanceAnimated = (listOffset, data) => {
  const distanceAnimated = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    distanceAnimated.setOffset(listOffset);
  }, [listOffset]);
  useEffect(()=> {
    distanceAnimated.extractOffset()
    distanceAnimated.setOffset(listOffset);
  },[ data.length])
  return distanceAnimated;
};

const useSize = (horizontal, width, height) => {
  const [size, setSize] = useState(0);
  useEffect(() => {
    setSize(horizontal ? width : height);
  }, [horizontal, width, height]);
  return size;
};
const useInputRanges = (data, size, space) => {
  const [inputRanges, setInputRanges] = useState([]);
  useEffect(() => {
    const _interpolator = data.map((item, index) => [
      (index - 1) * size - space,
      (index) * size - space,
      (index + 1) * size - space,
    ]);
    setInputRanges(_interpolator);
  }, [data.length, size, space]);
  return inputRanges;
};
