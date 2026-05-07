import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');

const ONBOARDING_KEY = '@hasSeenOnboarding';

const slides = [
  {
    emoji: '🧠',
    title: 'Welcome to Mindfull Minder',
    body: 'Gentle reminders designed for your unique mind. Create minders that check in with you, prompt reflections, and celebrate small wins — at your own pace.',
  },
  {
    emoji: '🔔',
    title: 'Stay connected with yourself',
    body: 'Mindfull Minder sends kind nudges throughout your day. We\'ll ask for permission to notify you — you control when and how often.',
  },
  {
    emoji: '✨',
    title: "You're all set!",
    body: 'Tap + Add Minder to create your first reminder. Start small — even "Take a breath" or "Drink some water" counts.',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [permissionRequested, setPermissionRequested] = useState(false);

  const goToSlide = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
    setCurrentIndex(index);
  };

  const handleNext = async () => {
    if (currentIndex === 1 && !permissionRequested) {
      setPermissionRequested(true);
      await Notifications.requestPermissionsAsync();
    }

    if (currentIndex < slides.length - 1) {
      goToSlide(currentIndex + 1);
    } else {
      await finish();
    }
  };

  const finish = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    router.replace('/(tabs)');
  };

  const isLast = currentIndex === slides.length - 1;
  const isPermSlide = currentIndex === 1;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.skipButton}
        onPress={finish}
        accessibilityLabel="Skip onboarding"
        accessibilityRole="button"
      >
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        style={styles.scrollView}
      >
        {slides.map((slide, i) => (
          <View key={i} style={[styles.slide, { width }]}>
            <Text style={styles.emoji}>{slide.emoji}</Text>
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.body}>{slide.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {slides.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === currentIndex && styles.dotActive]}
            />
          ))}
        </View>

        <TouchableOpacity
          style={styles.nextButton}
          onPress={handleNext}
          accessibilityLabel={isLast ? 'Get started' : isPermSlide ? 'Enable notifications' : 'Next'}
          accessibilityRole="button"
        >
          <Text style={styles.nextText}>
            {isLast ? "Let's Go" : isPermSlide ? 'Enable Notifications' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  skipButton: {
    alignSelf: 'flex-end',
    padding: 16,
  },
  skipText: {
    color: '#999',
    fontSize: 15,
  },
  scrollView: {
    flex: 1,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 20,
  },
  emoji: {
    fontSize: 72,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    color: '#222',
    lineHeight: 34,
  },
  body: {
    fontSize: 16,
    textAlign: 'center',
    color: '#555',
    lineHeight: 24,
  },
  footer: {
    width: '100%',
    paddingHorizontal: 32,
    paddingBottom: 32,
    gap: 24,
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#DDD',
  },
  dotActive: {
    backgroundColor: '#007BFF',
    width: 24,
  },
  nextButton: {
    backgroundColor: '#007BFF',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
  },
  nextText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '700',
  },
});
