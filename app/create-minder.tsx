import AsyncStorage from "@react-native-async-storage/async-storage"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import "react-native-get-random-values"
import { useTheme } from "../context/ThemeContext"
import { log } from "../logic/Logger"
import {
  cancelNotificationsForMinder,
  scheduleNotificationsForMinder,
} from "../logic/NotificationManager"
import {
  moveDateIntoTimeWindow,
  parseClockTimeToMinutes,
} from "../logic/TimeWindow"

const MINDERS_STORAGE_KEY = "@minders"

const colorsOptions = [
  "#FF6B6B",
  "#FFD166",
  "#06D6A0",
  "#118AB2",
  "#073B4C",
  "#9B5DE5",
  "#F15BB5",
  "#00BBF9",
  "#00F5D4",
  "#43AA8B",
  "#F3722C",
  "#577590",
]
const frequencyOptions = ["Continuous", "Daily", "Weekly"]
const intervalOptions = ["Equal", "Random"]
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"]
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

const buildTimeOptions = () => {
  const options: string[] = []
  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0")
    const mm = String(minutes % 60).padStart(2, "0")
    options.push(`${hh}:${mm}`)
  }
  return options
}

const formatTimeLabel = (hhmm: string) => {
  const parsed = parseClockTimeToMinutes(hhmm)
  if (parsed === null) return hhmm
  const hours24 = Math.floor(parsed / 60)
  const minutes = parsed % 60
  const suffix = hours24 >= 12 ? "PM" : "AM"
  const hours12 = ((hours24 + 11) % 12) + 1
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`
}

const MINDER_TEMPLATES = [
  {
    name: "Medication",
    note: "Take your medication",
    color: "#FF6B6B",
    reminderFrequency: "Daily",
    quantity: 2,
    intervalType: "Equal",
    minderType: "complete" as const,
    notificationStartTime: "08:00",
    notificationEndTime: "20:00",
  },
  {
    name: "Drink Water",
    note: "Drink a glass of water",
    color: "#118AB2",
    reminderFrequency: "Daily",
    quantity: 4,
    intervalType: "Equal",
    minderType: "complete" as const,
    notificationStartTime: "08:00",
    notificationEndTime: "20:00",
  },
  {
    name: "Sensory Break",
    note: "Step away, breathe, and reset",
    color: "#06D6A0",
    reminderFrequency: "Daily",
    quantity: 3,
    intervalType: "Random",
    minderType: "complete" as const,
    notificationStartTime: "09:00",
    notificationEndTime: "17:00",
  },
  {
    name: "Mood Check",
    note: "How are you feeling right now?",
    color: "#9370DB",
    reminderFrequency: "Daily",
    quantity: 2,
    intervalType: "Equal",
    minderType: "note" as const,
    notificationStartTime: "10:00",
    notificationEndTime: "19:00",
  },
  {
    name: "Stretch",
    note: "Take a moment to stretch",
    color: "#FFD166",
    reminderFrequency: "Daily",
    quantity: 3,
    intervalType: "Equal",
    minderType: "complete" as const,
    notificationStartTime: "09:00",
    notificationEndTime: "17:00",
  },
  {
    name: "Mindful Moment",
    note: "Pause and notice what you feel",
    color: "#FF69B4",
    reminderFrequency: "Daily",
    quantity: 2,
    intervalType: "Random",
    minderType: "note" as const,
    notificationStartTime: "08:00",
    notificationEndTime: "20:00",
  },
]

export default function CreateMinderScreen() {
  const { colors } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams()
  const [minderId, setMinderId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [selectedColor, setSelectedColor] = useState(colorsOptions[0])
  const [reminderFrequency, setReminderFrequency] = useState(
    frequencyOptions[1],
  )
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState("")
  const [intervalType, setIntervalType] = useState(intervalOptions[0])
  const [triggerTimesPreview, setTriggerTimesPreview] = useState<Date[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [notificationStartTime, setNotificationStartTime] = useState("08:00")
  const [notificationEndTime, setNotificationEndTime] = useState("20:00")
  const [selectedWeekdays, setSelectedWeekdays] =
    useState<number[]>(ALL_WEEKDAYS)
  const [timePickerVisible, setTimePickerVisible] = useState(false)
  const [timePickerTarget, setTimePickerTarget] = useState<"start" | "end">(
    "start",
  )
  const [minderType, setMinderType] = useState<"complete" | "note">("complete")
  const timePickerScrollRef = useRef<ScrollView>(null)

  useEffect(() => {
    if (params.minderId) {
      log.info(`Loading minder with ID: ${params.minderId}`)
      setMinderId(params.minderId as string)
      loadMinderData(params.minderId as string)
    }
  }, [params.minderId])

  // Scroll the time picker to the currently selected value when it opens.
  useEffect(() => {
    if (!timePickerVisible) return
    const selectedTime =
      timePickerTarget === "start" ? notificationStartTime : notificationEndTime
    const options = buildTimeOptions()
    const idx = options.indexOf(selectedTime)
    if (idx < 0) return
    // Each item: paddingVertical 10 (×2) + ~16px text + marginBottom 6 ≈ 42px
    const ITEM_HEIGHT = 42
    const offset = Math.max(0, idx * ITEM_HEIGHT - ITEM_HEIGHT * 2)
    setTimeout(
      () =>
        timePickerScrollRef.current?.scrollTo({ y: offset, animated: false }),
      50,
    )
  }, [
    timePickerVisible,
    timePickerTarget,
    notificationStartTime,
    notificationEndTime,
  ])

  const loadMinderData = async (id: string) => {
    try {
      const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY)
      if (!storedMinders) return
      const parsed = JSON.parse(storedMinders)
      if (!Array.isArray(parsed)) return
      const minderToEdit = parsed.find(
        (m: unknown) =>
          m !== null && typeof m === "object" && (m as any).id === id,
      ) as any | undefined
      if (!minderToEdit) return
      setName(typeof minderToEdit.name === "string" ? minderToEdit.name : "")
      setSelectedColor(
        typeof minderToEdit.color === "string"
          ? minderToEdit.color
          : colorsOptions[0],
      )
      setReminderFrequency(
        frequencyOptions.includes(minderToEdit.reminderFrequency)
          ? minderToEdit.reminderFrequency
          : frequencyOptions[1],
      )
      setQuantity(
        typeof minderToEdit.quantity === "number"
          ? minderToEdit.quantity
          : Number(minderToEdit.quantity) || 1,
      )
      setNote(typeof minderToEdit.note === "string" ? minderToEdit.note : "")
      setIntervalType(
        intervalOptions.includes(minderToEdit.intervalType)
          ? minderToEdit.intervalType
          : intervalOptions[0],
      )
      setNotificationStartTime(
        typeof minderToEdit.notificationStartTime === "string"
          ? minderToEdit.notificationStartTime
          : "08:00",
      )
      setNotificationEndTime(
        typeof minderToEdit.notificationEndTime === "string"
          ? minderToEdit.notificationEndTime
          : "20:00",
      )
      const rawDays = (minderToEdit as { selectedWeekdays?: unknown })
        .selectedWeekdays
      const parsedDays = Array.isArray(rawDays)
        ? rawDays.filter(
            (v): v is number => Number.isInteger(v) && v >= 0 && v <= 6,
          )
        : []
      setSelectedWeekdays(parsedDays.length > 0 ? parsedDays : ALL_WEEKDAYS)
      setMinderType(minderToEdit.minderType === "note" ? "note" : "complete")
    } catch (err) {
      log.error("Failed to load minder data for editing:", err)
    }
  }

  const applyTemplate = (template: (typeof MINDER_TEMPLATES)[number]) => {
    setName(template.name)
    setNote(template.note)
    setSelectedColor(template.color)
    setReminderFrequency(template.reminderFrequency)
    setQuantity(template.quantity)
    setIntervalType(template.intervalType)
    setMinderType(template.minderType)
    setNotificationStartTime(template.notificationStartTime)
    setNotificationEndTime(template.notificationEndTime)
    setSelectedWeekdays(ALL_WEEKDAYS)
  }

  const calculateTriggerTimesPreview = useCallback(async () => {
    const now = new Date()
    const times: Date[] = []
    const totalQuantity = quantity || 1

    const startMinutes = parseClockTimeToMinutes(notificationStartTime)
    const endMinutes = parseClockTimeToMinutes(notificationEndTime)
    const hasWindow =
      startMinutes !== null &&
      endMinutes !== null &&
      startMinutes !== endMinutes

    if (
      reminderFrequency === "Daily" &&
      hasWindow &&
      startMinutes !== null &&
      endMinutes !== null
    ) {
      const windowMs =
        endMinutes > startMinutes
          ? (endMinutes - startMinutes) * 60 * 1000
          : (24 * 60 - startMinutes + endMinutes) * 60 * 1000

      const todayWindowStart = new Date(now)
      todayWindowStart.setHours(
        Math.floor(startMinutes / 60),
        startMinutes % 60,
        0,
        0,
      )

      // Generate candidate slots across days, then pick the next N upcoming.
      const candidates: Date[] = []
      for (let day = 0; day <= 14; day++) {
        const dayWindowStart = new Date(
          todayWindowStart.getTime() + day * 24 * 60 * 60 * 1000,
        )
        for (let i = 0; i < totalQuantity; i++) {
          const ratio = totalQuantity === 1 ? 0 : i / (totalQuantity - 1)
          const base = dayWindowStart.getTime() + windowMs * ratio
          let t = new Date(base)
          if (intervalType === "Random") {
            if (totalQuantity === 1) {
              const randomMsInWindow = Math.random() * windowMs
              t = moveDateIntoTimeWindow(
                new Date(dayWindowStart.getTime() + randomMsInWindow),
                startMinutes,
                endMinutes,
              )
            } else {
              const slotSpacing = windowMs / (totalQuantity - 1)
              const randomOffset = (Math.random() - 0.5) * slotSpacing
              t = moveDateIntoTimeWindow(
                new Date(base + randomOffset),
                startMinutes,
                endMinutes,
              )
            }
          }
          if (t > now && selectedWeekdays.includes(t.getDay()))
            candidates.push(t)
        }
      }

      // Keep strictly sorted unique times so preview never shows duplicate timestamps.
      const uniqueSorted = candidates
        .sort((a, b) => a.getTime() - b.getTime())
        .filter(
          (t, idx, arr) => idx === 0 || t.getTime() !== arr[idx - 1].getTime(),
        )

      times.push(...uniqueSorted.slice(0, totalQuantity))
    } else {
      const timeSpan =
        reminderFrequency === "Daily"
          ? 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000
      const interval = timeSpan / totalQuantity
      for (let i = 0; i < totalQuantity; i++) {
        let potentialTime = new Date(now.getTime() + (i + 1) * interval)
        if (intervalType === "Random") {
          const randomOffset = (Math.random() - 0.5) * 0.6 * interval
          potentialTime.setTime(potentialTime.getTime() + randomOffset)
        }
        if (hasWindow && startMinutes !== null && endMinutes !== null) {
          potentialTime = moveDateIntoTimeWindow(
            potentialTime,
            startMinutes,
            endMinutes,
          )
        }
        times.push(potentialTime)
      }
    }

    setTriggerTimesPreview(times)
    return times
  }, [
    intervalType,
    notificationEndTime,
    notificationStartTime,
    quantity,
    reminderFrequency,
    selectedWeekdays,
  ])

  const toggleWeekday = (dayIndex: number) => {
    setSelectedWeekdays((prev) => {
      const exists = prev.includes(dayIndex)
      if (exists) {
        if (prev.length === 1) return prev
        return prev.filter((d) => d !== dayIndex)
      }
      return [...prev, dayIndex].sort((a, b) => a - b)
    })
  }

  useEffect(() => {
    if (reminderFrequency !== "Continuous") {
      void calculateTriggerTimesPreview()
    }
  }, [calculateTriggerTimesPreview, reminderFrequency])

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Error", "Please enter a name for the minder.")
      return
    }

    setProgress(0)
    setIsProcessing(true)

    try {
      log.info(`Saving minder: ${name}`)

      const numQuantity = quantity || 1
      if (reminderFrequency === "Daily" && numQuantity > 24) {
        Alert.alert("Error", "Maximum daily triggers is 24.")
        setIsProcessing(false)
        return
      }
      if (reminderFrequency === "Weekly" && numQuantity > 100) {
        Alert.alert("Error", "Maximum weekly triggers is 100.")
        setIsProcessing(false)
        return
      }

      let triggerTimes: { hours: number; minutes: number }[] = []
      if (reminderFrequency !== "Continuous" && intervalType === "Equal") {
        const computed = await calculateTriggerTimesPreview() // Use the preview calculation
        triggerTimes = computed.map((t) => ({
          hours: t.getHours(),
          minutes: t.getMinutes(),
        }))
      }

      const newMinder = {
        id: minderId || `${Date.now()}-${Math.random()}`,
        name,
        color: selectedColor,
        reminderFrequency,
        quantity: numQuantity,
        note,
        intervalType,
        triggerTimes,
        notificationStartTime,
        notificationEndTime,
        selectedWeekdays:
          reminderFrequency === "Daily" ? selectedWeekdays : ALL_WEEKDAYS,
        minderType,
        successStreak: minderId ? undefined : 0,
      }

      const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY)
      let minders = storedMinders ? JSON.parse(storedMinders) : []
      if (minderId) {
        minders = minders.map((m: any) => (m.id === minderId ? newMinder : m))
      } else {
        minders.push(newMinder)
      }

      await AsyncStorage.setItem(MINDERS_STORAGE_KEY, JSON.stringify(minders))
      log.info(`Minder saved: ${JSON.stringify(newMinder)}`)
      const slotResult = await scheduleNotificationsForMinder(
        newMinder,
        setProgress,
      )

      setIsProcessing(false)

      if (slotResult.planned > 0 && slotResult.scheduled < slotResult.planned) {
        Alert.alert(
          "Notification Limit Reached",
          `Only ${slotResult.scheduled} of ${slotResult.planned} notifications could be scheduled. To fix this, reduce how often other minders fire or create fewer minders.`,
        )
      }

      if (router.canGoBack()) {
        router.back()
      } else {
        router.replace("/(tabs)")
      }
    } catch (error) {
      setIsProcessing(false)
      log.error("Error saving minder:", error)
      Alert.alert("Error", "An error occurred while saving the minder.")
    }
  }

  const handleDelete = () => {
    if (!minderId) return
    Alert.alert(
      "Delete Minder",
      "This will remove the minder and cancel all its scheduled reminders. Your log history will be kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await cancelNotificationsForMinder(minderId)
              const stored = await AsyncStorage.getItem(MINDERS_STORAGE_KEY)
              const list = stored ? JSON.parse(stored) : []
              await AsyncStorage.setItem(
                MINDERS_STORAGE_KEY,
                JSON.stringify(list.filter((m: any) => m.id !== minderId)),
              )
              log.info(`Deleted minder: ${minderId}`)
              if (router.canGoBack()) {
                router.back()
              } else {
                router.replace("/(tabs)")
              }
            } catch (err) {
              log.error("Error deleting minder:", err)
              Alert.alert(
                "Error",
                "Could not delete the minder. Please try again.",
              )
            }
          },
        },
      ],
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Modal
        transparent={true}
        animationType="fade"
        visible={isProcessing}
        onRequestClose={() => {}}
      >
        <View style={styles.modalBackground}>
          <View
            style={[
              styles.activityIndicatorWrapper,
              { backgroundColor: colors.card },
            ]}
          >
            <Text
              style={{ color: colors.text, marginBottom: 15, fontSize: 16 }}
            >
              Scheduling... {Math.round(progress * 100)}%
            </Text>
            <View style={styles.progressBarContainer}>
              <View
                style={[
                  styles.progressBar,
                  {
                    width: `${progress * 100}%`,
                    backgroundColor: colors.primary,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      </Modal>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <TextInput
          style={[
            styles.input,
            { color: colors.text, backgroundColor: colors.card },
          ]}
          placeholder="Minder Name"
          placeholderTextColor={colors.text}
          value={name}
          onChangeText={setName}
        />
        {!minderId && (
          <View style={styles.templateSection}>
            <Text style={[styles.templateLabel, { color: colors.text }]}>
              Start from a template:
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
            >
              {MINDER_TEMPLATES.map((t) => (
                <TouchableOpacity
                  key={t.name}
                  style={[styles.templateChip, { backgroundColor: t.color }]}
                  onPress={() => applyTemplate(t)}
                  accessibilityLabel={`Use ${t.name} template`}
                  accessibilityRole="button"
                >
                  <Text style={styles.templateChipText}>{t.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        <View style={styles.optionGroup}>
          <Text style={{ color: colors.text }}>Color:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.colorScroll}
            contentContainerStyle={styles.colorContainer}
          >
            {colorsOptions.map((color) => (
              <TouchableOpacity
                key={color}
                onPress={() => setSelectedColor(color)}
                style={styles.colorTouchable}
              >
                <View
                  style={[
                    styles.colorOption,
                    {
                      backgroundColor: color,
                      borderWidth: selectedColor === color ? 2 : 0,
                      borderColor: colors.text,
                    },
                  ]}
                />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        <View style={styles.optionGroup}>
          <Text style={{ color: colors.text }}>Reminder Frequency:</Text>
          <View style={styles.buttonContainer}>
            {frequencyOptions.map((freq) => (
              <TouchableOpacity
                key={freq}
                style={[
                  styles.button,
                  {
                    backgroundColor:
                      reminderFrequency === freq ? colors.primary : colors.card,
                  },
                ]}
                onPress={() => setReminderFrequency(freq)}
              >
                <Text
                  style={{
                    color: reminderFrequency === freq ? "white" : colors.text,
                  }}
                >
                  {freq}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {reminderFrequency === "Daily" && (
          <View
            style={[styles.optionGroup, { justifyContent: "space-between" }]}
          >
            <Text style={{ color: colors.text }}>Days:</Text>
            <View style={styles.weekdayContainer}>
              {WEEKDAY_LABELS.map((label, idx) => {
                const isSelected = selectedWeekdays.includes(idx)
                return (
                  <TouchableOpacity
                    key={`${label}-${idx}`}
                    onPress={() => toggleWeekday(idx)}
                    style={[
                      styles.weekdayChip,
                      {
                        backgroundColor: isSelected
                          ? colors.primary
                          : colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`Toggle ${label} reminders`}
                  >
                    <Text
                      style={{
                        color: isSelected ? "white" : colors.text,
                        fontWeight: "700",
                      }}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        )}

        {reminderFrequency !== "Continuous" && (
          <>
            <View
              style={[styles.optionGroup, { justifyContent: "space-between" }]}
            >
              <Text style={{ color: colors.text }}>
                Times per {reminderFrequency === "Daily" ? "day" : "week"}:
              </Text>
              <View style={styles.sliderContainer}>
                {[1, 2, 3, 4, 5].map((v) => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => setQuantity(v)}
                    style={[
                      styles.sliderStep,
                      {
                        backgroundColor:
                          quantity === v ? colors.primary : colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: quantity === v ? "white" : colors.text,
                        fontWeight: "600",
                      }}
                    >
                      {v}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View
              style={[styles.optionGroup, { justifyContent: "space-between" }]}
            >
              <Text style={{ color: colors.text }}>Notification window:</Text>
              <View style={styles.timeWindowContainer}>
                <TouchableOpacity
                  style={[
                    styles.timeButton,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => {
                    setTimePickerTarget("start")
                    setTimePickerVisible(true)
                  }}
                >
                  <Text style={{ color: colors.text }}>
                    {formatTimeLabel(notificationStartTime)}
                  </Text>
                </TouchableOpacity>
                <Text style={{ color: colors.text, paddingHorizontal: 8 }}>
                  to
                </Text>
                <TouchableOpacity
                  style={[
                    styles.timeButton,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => {
                    setTimePickerTarget("end")
                    setTimePickerVisible(true)
                  }}
                >
                  <Text style={{ color: colors.text }}>
                    {formatTimeLabel(notificationEndTime)}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.optionGroup}>
              <Text style={{ color: colors.text }}>Interval Type:</Text>
              <View style={styles.buttonContainer}>
                {intervalOptions.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.button,
                      {
                        backgroundColor:
                          intervalType === type ? colors.primary : colors.card,
                      },
                    ]}
                    onPress={() => setIntervalType(type)}
                  >
                    <Text
                      style={{
                        color: intervalType === type ? "white" : colors.text,
                      }}
                    >
                      {type}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View
              style={[
                styles.triggerTimesContainer,
                { backgroundColor: colors.card },
              ]}
            >
              <Text style={{ color: colors.text, fontWeight: "bold" }}>
                Upcoming Triggers Preview:
              </Text>
              {triggerTimesPreview.map((time, index) => (
                <Text key={index} style={{ color: colors.text }}>
                  {time.toLocaleString()}
                </Text>
              ))}
            </View>
          </>
        )}
        <View style={styles.optionGroup}>
          <Text style={{ color: colors.text }}>Completion type:</Text>
          <View style={styles.buttonContainer}>
            {(["complete", "note"] as const).map((type) => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.button,
                  {
                    backgroundColor:
                      minderType === type ? colors.primary : colors.card,
                  },
                ]}
                onPress={() => setMinderType(type)}
              >
                <Text
                  style={{ color: minderType === type ? "white" : colors.text }}
                >
                  {type === "complete" ? "Mark Complete" : "Requires Note"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.text,
              backgroundColor: colors.card,
              marginTop: 10,
              height: 100,
            },
          ]}
          placeholder="Description or notes: (optional)"
          placeholderTextColor={colors.text}
          value={note}
          onChangeText={setNote}
          multiline
        />
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.primary }]}
          onPress={handleSave}
          accessibilityLabel="Save minder"
          accessibilityRole="button"
        >
          <Text style={styles.saveButtonText}>Save Minder</Text>
        </TouchableOpacity>
        {minderId && (
          <TouchableOpacity
            style={[styles.deleteButton]}
            onPress={handleDelete}
            accessibilityLabel="Delete this minder"
            accessibilityRole="button"
          >
            <Text style={styles.deleteButtonText}>Delete Minder</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal
        transparent
        animationType="fade"
        visible={timePickerVisible}
        onRequestClose={() => setTimePickerVisible(false)}
        accessibilityViewIsModal
      >
        <View style={styles.modalBackground}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setTimePickerVisible(false)}
          />
          <View
            style={[
              styles.timePickerCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 16,
                fontWeight: "600",
                marginBottom: 12,
              }}
            >
              Select {timePickerTarget === "start" ? "Start" : "End"} Time
            </Text>
            <ScrollView ref={timePickerScrollRef} style={{ maxHeight: 320 }}>
              {buildTimeOptions().map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.timeOption,
                    {
                      backgroundColor:
                        (timePickerTarget === "start"
                          ? notificationStartTime
                          : notificationEndTime) === option
                          ? colors.primary
                          : "transparent",
                    },
                  ]}
                  onPress={() => {
                    if (timePickerTarget === "start")
                      setNotificationStartTime(option)
                    else setNotificationEndTime(option)
                    setTimePickerVisible(false)
                  }}
                >
                  <Text
                    style={{
                      color:
                        (timePickerTarget === "start"
                          ? notificationStartTime
                          : notificationEndTime) === option
                          ? "white"
                          : colors.text,
                      paddingVertical: 10,
                    }}
                  >
                    {formatTimeLabel(option)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  input: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 16,
  },
  optionGroup: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  sliderContainer: {
    flexDirection: "row",
    gap: 8,
  },
  sliderStep: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 36,
    alignItems: "center",
  },
  weekdayContainer: {
    flexDirection: "row",
    gap: 6,
  },
  weekdayChip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  timeWindowContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  timeButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  timePickerCard: {
    width: "80%",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  timeOption: {
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  colorContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 8,
  },
  colorScroll: {
    flex: 1,
    marginLeft: 12,
  },
  colorTouchable: {
    marginRight: 10,
  },
  colorOption: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flex: 1,
    gap: 8,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  saveButton: {
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 20,
    marginBottom: 20,
  },
  saveButtonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
  triggerTimesContainer: {
    marginTop: 16,
    padding: 10,
    borderRadius: 5,
    marginBottom: 20,
  },
  modalBackground: {
    flex: 1,
    alignItems: "center",
    flexDirection: "column",
    justifyContent: "space-around",
    backgroundColor: "#00000040",
  },
  activityIndicatorWrapper: {
    padding: 25,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-around",
    width: "70%",
  },
  progressBarContainer: {
    height: 10,
    width: "100%",
    backgroundColor: "#e0e0e0",
    borderRadius: 5,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 5,
  },
  deleteButton: {
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#FF3B30",
  },
  deleteButtonText: {
    color: "#FF3B30",
    fontSize: 16,
    fontWeight: "600",
  },
  templateSection: {
    marginBottom: 16,
  },
  templateLabel: {
    fontSize: 13,
    opacity: 0.7,
    marginBottom: 8,
  },
  templateChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  templateChipText: {
    color: "white",
    fontWeight: "600",
    fontSize: 14,
  },
})
