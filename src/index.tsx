import React, {  useEffect, useState, useRef, useMemo } from 'react';
import { Animated, Dimensions } from 'react-native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';


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
  scrollEnabled = true,
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
  const timer = useRef(null);
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

  const onceAnimated = (nextIndex: number) => {
    const realNextIndex = positions[nextIndex] ? nextIndex : activeIndex.current;
    const nextItem = data[realNextIndex];
    let toValue = -positions[realNextIndex]?.start;
    if (onBeforeSnapToItem) {
      onBeforeSnapToItem({ item: nextItem.item, index: nextItem.realIndex });
    }
    distanceAnimated.flattenOffset();
    Animated.timing(distanceAnimated, {
      toValue,
      duration: autoplayDuration,
      useNativeDriver
    }).start(() => {
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
    clearTimeout(timer.current);
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
      _lastOffset.current += translation;
      const _translation = scrollStepper === 'nearest' ? (translation % size) : translation;
      const moveCount = scrollStepper === 'nearest' ? (Math.floor(translation / size) + (translation > 0 ? 0 : 1)) : 0;
      const nextIndex = activeIndex.current - moveCount + ((swipeThreshold < Math.abs(_translation)) ? (translation > 0 ? -1 : 1) : 0);
      onceAnimated(nextIndex);
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
    >
      <Animated.View style={[{
        width: sliderWidth,
        height: sliderHeight,
        overflow: 'hidden',
      }, horizontal ? {justifyContent: 'center'}: {alignItems: 'center',}]}
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
                style={{
                  width: itemWidth,
                  height: itemHeight,
                }}
                key={`carousel-${index}`}
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

const useLoopClonesPerSide = (data, loop: boolean, propsLoopClonesPerSide: number ) => {
  const [loopClonesPerSide, setLoopClonesPerSide] = useState( 0)
  useEffect(() => {
    const len = data.length;
    if (loop) {
      setLoopClonesPerSide( len < propsLoopClonesPerSide ? propsLoopClonesPerSide : len )
    } else {
      setLoopClonesPerSide(0)
    }
  },[data.length, propsLoopClonesPerSide, loop])
return loopClonesPerSide;
}

const useData = (arr: Array<any> = [], loop: boolean = true, loopClonesPerSide: number): Array<{
  readonly realIndex: number,
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
    setData(_getData(arr));
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
