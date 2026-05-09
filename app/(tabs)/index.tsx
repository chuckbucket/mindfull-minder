import { Ionicons } from "@expo/vector-icons"
import AsyncStorage from "@react-native-async-storage/async-storage"
import * as Haptics from "expo-haptics"
import * as Notifications from "expo-notifications"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import * as StoreReview from "expo-store-review"
import { useCallback, useEffect, useState } from "react"
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useTheme } from "../../context/ThemeContext"
import {
  addMinderEvent,
  getAllMinderEvents,
  MinderEvent,
  upsertMissedEvents,
} from "../../logic/MinderEvents"
import { scheduleNotificationsForAllMinders } from "../../logic/NotificationManager"

const MINDERS_STORAGE_KEY = "@minders"
const COMPLETIONS_STORAGE_KEY = "@completions"
const REVIEW_COUNT_KEY = "@totalCompletionCount"

interface Minder {
  id: string
  name: string
  color: string
  reminderFrequency: string
  quantity: number
  note?: string
  successStreak?: number
  notificationStartTime?: string
  notificationEndTime?: string
  minderType?: "complete" | "note"
  paused?: boolean
}

const toStatDateKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function computeCardStats(events: MinderEvent[]): { completionRate: number | null; streak: number } {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const recent = events.filter(e => e.at >= sevenDaysAgo)
  const recentCompleted = recent.filter(e => e.kind === 'completed').length
  const recentMissed = recent.filter(e => e.kind === 'missed').length
  const total = recentCompleted + recentMissed
  const completionRate = total > 0 ? Math.round((recentCompleted / total) * 100) : null

  const completionDayKeys = new Set(events.filter(e => e.kind === 'completed').map(e => toStatDateKey(e.at)))
  const todayKey = toStatDateKey(Date.now())
  let streak = 0
  const startDay = completionDayKeys.has(todayKey) ? 0 : 1
  for (let i = startDay; i < 365; i++) {
    if (completionDayKeys.has(toStatDateKey(Date.now() - i * 86400000))) streak++
    else break
  }

  return { completionRate, streak }
}

const formatHHMM = (hhmm: string): string => {
  const [h, m] = hhmm.split(":").map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

export default function HomeScreen() {
  const [minders, setMinders] = useState<Minder[]>([])
  const [notifications, setNotifications] = useState<
    Notifications.Notification[]
  >([])
  const [completions, setCompletions] = useState<{ [key: string]: number[] }>(
    {},
  )
  const [handledTriggerAtsByMinder, setHandledTriggerAtsByMinder] = useState<
    Record<string, number[]>
  >({})
  const [triggeredTriggerAtsByMinder, setTriggeredTriggerAtsByMinder] =
    useState<Record<string, number[]>>({})
  const [noteModalVisible, setNoteModalVisible] = useState(false)
  const [noteText, setNoteText] = useState("")
  const [noteMinderId, setNoteMinderId] = useState<string | null>(null)
  const [noteTriggerAt, setNoteTriggerAt] = useState<number | undefined>(
    undefined,
  )
  const [noteMood, setNoteMood] = useState<"good" | "neutral" | "bad">(
    "neutral",
  )
  const [notifStatus, setNotifStatus] = useState<string>("unknown")
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set())
  const [reorderMode, setReorderMode] = useState(false)
  const [minderStatsMap, setMinderStatsMap] = useState<Record<string, { completionRate: number | null; streak: number }>>({})

  const { colors } = useTheme()
  const router = useRouter()
  const { openLogFor, logTriggerAt, openCompleteFor, openCompleteMinderName, completeTriggerAt } = useLocalSearchParams<{
    openLogFor?: string
    logTriggerAt?: string
    openCompleteFor?: string
    openCompleteMinderName?: string
    completeTriggerAt?: string
  }>()

  useEffect(() => {
    scheduleNotificationsForAllMinders()
  }, [])

  useEffect(() => {
    if (!openLogFor) return
    const ta = logTriggerAt ? Number(logTriggerAt) : undefined
    openNoteModal(
      openLogFor,
      typeof ta === "number" && !isNaN(ta) ? ta : undefined,
    )
    router.setParams({ openLogFor: undefined, logTriggerAt: undefined })
  }, [openLogFor])

  useEffect(() => {
    if (!openCompleteFor) return
    const ta = completeTriggerAt ? Number(completeTriggerAt) : undefined
    const triggerAtMs = typeof ta === "number" && !isNaN(ta) ? ta : undefined
    const displayName = openCompleteMinderName || "minder"
    router.setParams({ openCompleteFor: undefined, openCompleteMinderName: undefined, completeTriggerAt: undefined })
    Alert.alert(
      "Mark Complete?",
      `Mark "${displayName}" as complete?`,
      [
        { text: "Not yet", style: "cancel" },
        {
          text: "Mark Complete",
          onPress: () => handleComplete(openCompleteFor, triggerAtMs),
        },
      ],
    )
  }, [openCompleteFor])

  const checkNotifPermission = useCallback(async () => {
    const { status } = await Notifications.getPermissionsAsync()
    setNotifStatus(status)
  }, [])

  const getClosestTriggerAtWithinWindow = useCallback(
    (minderId: string, atMs: number, windowMs: number) => {
      const candidates: number[] = []

      const scheduled = (notifications as any[])
        .filter((n) => n?.content?.data?.minderId === minderId)
        .map(
          (n) => n?.trigger?.value ?? n?.trigger?.timestamp ?? n?.trigger?.date,
        )
        .filter(Boolean)
        .map((d: any) => new Date(d).getTime())
        .filter(
          (t: any) => typeof t === "number" && !Number.isNaN(t),
        ) as number[]
      candidates.push(...scheduled)

      const triggered = triggeredTriggerAtsByMinder[minderId] || []
      candidates.push(...triggered)

      if (candidates.length === 0) return undefined

      let best: number | undefined
      let bestDiff = Infinity
      for (const t of candidates) {
        const diff = Math.abs(t - atMs)
        if (diff < bestDiff) {
          best = t
          bestDiff = diff
        }
      }
      if (bestDiff <= windowMs) return best
      return undefined
    },
    [notifications, triggeredTriggerAtsByMinder],
  )

  const syncMissedReminders = useCallback(
    async (
      loadedMinders: Minder[],
      scheduled: any[],
      loadedCompletions: { [key: string]: number[] },
      handledTriggerAtsSnapshot: Record<string, Set<number>>,
      logAtsByMinder: Record<string, number[]>,
    ) => {
      const now = Date.now()
      const TWO_HOURS = 2 * 60 * 60 * 1000
      const missedByMinder: Record<string, number[]> = {}

      for (const notif of scheduled) {
        const minderId = notif?.content?.data?.minderId
        const triggerDateValue =
          (notif?.trigger as any)?.value ?? notif?.trigger?.timestamp
        if (!minderId || !triggerDateValue) continue

        const triggerAt = new Date(triggerDateValue).getTime()
        if (Number.isNaN(triggerAt) || triggerAt > now) continue

        const minder = loadedMinders.find((m) => m.id === minderId)
        if (!minder || minder.reminderFrequency === "Continuous") continue

        if (handledTriggerAtsSnapshot[minderId]?.has(triggerAt) ?? false)
          continue
        const legacy = loadedCompletions[minderId] || []
        if (legacy.some((compTime) => compTime > triggerAt)) continue

        const logAts = logAtsByMinder[minderId] || []
        if (logAts.some((logAt) => Math.abs(logAt - triggerAt) <= TWO_HOURS))
          continue

        missedByMinder[minderId] = missedByMinder[minderId] || []
        missedByMinder[minderId].push(triggerAt)
      }

      await Promise.all(
        Object.entries(missedByMinder).map(([minderId, triggerAts]) =>
          upsertMissedEvents(minderId, triggerAts),
        ),
      )
    },
    [],
  )

  const loadData = useCallback(async () => {
    try {
      const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY)
      const loadedMinders = storedMinders
        ? (JSON.parse(storedMinders) as Minder[])
        : []
      setMinders(loadedMinders)

      const scheduledNotifications =
        await Notifications.getAllScheduledNotificationsAsync()
      setNotifications(scheduledNotifications)

      const storedCompletions = await AsyncStorage.getItem(
        COMPLETIONS_STORAGE_KEY,
      )
      const loadedCompletions = storedCompletions
        ? (JSON.parse(storedCompletions) as { [key: string]: number[] })
        : {}
      setCompletions(loadedCompletions)

      const allEvents = await getAllMinderEvents()
      const handledMap: Record<string, Set<number>> = {}
      const triggeredMap: Record<string, Set<number>> = {}
      const logAtsMap: Record<string, number[]> = {}
      for (const event of allEvents) {
        if (event.kind === "triggered") {
          if (typeof event.triggerAt !== "number") continue
          triggeredMap[event.minderId] =
            triggeredMap[event.minderId] || new Set<number>()
          triggeredMap[event.minderId].add(event.triggerAt)
        }
        if (
          event.kind === "completed" ||
          event.kind === "log" ||
          event.kind === "note"
        ) {
          if (typeof event.triggerAt === "number") {
            handledMap[event.minderId] =
              handledMap[event.minderId] || new Set<number>()
            handledMap[event.minderId].add(event.triggerAt)
          }
          logAtsMap[event.minderId] = logAtsMap[event.minderId] || []
          logAtsMap[event.minderId].push(event.at)
        }
      }
      setHandledTriggerAtsByMinder(
        Object.fromEntries(
          Object.entries(handledMap).map(([id, set]) => [
            id,
            Array.from(set.values()),
          ]),
        ),
      )
      setTriggeredTriggerAtsByMinder(
        Object.fromEntries(
          Object.entries(triggeredMap).map(([id, set]) => [
            id,
            Array.from(set.values()),
          ]),
        ),
      )

      // Compute per-minder stats for card dashboards
      const eventsByMinder = new Map<string, MinderEvent[]>()
      for (const event of allEvents) {
        if (event.minderId === '__global__') continue
        const list = eventsByMinder.get(event.minderId) ?? []
        list.push(event)
        eventsByMinder.set(event.minderId, list)
      }
      const statsMap: Record<string, { completionRate: number | null; streak: number }> = {}
      for (const m of loadedMinders) {
        statsMap[m.id] = computeCardStats(eventsByMinder.get(m.id) ?? [])
      }
      setMinderStatsMap(statsMap)

      await syncMissedReminders(
        loadedMinders,
        scheduledNotifications as any[],
        loadedCompletions,
        handledMap,
        logAtsMap,
      )
    } catch (error) {
      console.error("Error loading data:", error)
    }
  }, [syncMissedReminders])

  useFocusEffect(
    useCallback(() => {
      void loadData()
      void checkNotifPermission()
    }, [loadData, checkNotifPermission]),
  )

  const maybeRequestReview = async () => {
    try {
      const raw = await AsyncStorage.getItem(REVIEW_COUNT_KEY)
      const count = (Number(raw) || 0) + 1
      await AsyncStorage.setItem(REVIEW_COUNT_KEY, String(count))
      if (count === 7) {
        const available = await StoreReview.isAvailableAsync()
        if (available) await StoreReview.requestReview()
      }
    } catch {
      // non-critical
    }
  }

  const handleComplete = async (minderId: string, triggerAt?: number) => {
    if (completingIds.has(minderId)) return
    setCompletingIds((prev) => new Set([...prev, minderId]))
    try {
      const updatedMinders = minders.map((minder) => {
        if (
          minder.id === minderId &&
          minder.reminderFrequency === "Continuous"
        ) {
          return { ...minder, successStreak: (minder.successStreak || 0) + 1 }
        }
        return minder
      })
      setMinders(updatedMinders)
      await AsyncStorage.setItem(
        MINDERS_STORAGE_KEY,
        JSON.stringify(updatedMinders),
      )

      const storedCompletions = await AsyncStorage.getItem(
        COMPLETIONS_STORAGE_KEY,
      )
      const currentCompletions = storedCompletions
        ? JSON.parse(storedCompletions)
        : {}
      if (!currentCompletions[minderId]) {
        currentCompletions[minderId] = []
      }
      const completedAt = Date.now()
      currentCompletions[minderId].push(completedAt)
      setCompletions(currentCompletions)
      await AsyncStorage.setItem(
        COMPLETIONS_STORAGE_KEY,
        JSON.stringify(currentCompletions),
      )

      await addMinderEvent({
        minderId,
        kind: "completed",
        at: completedAt,
        triggerAt,
      })

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      await maybeRequestReview()
      Alert.alert("Done!", "Minder marked as complete!")
      void loadData()
    } catch (error) {
      console.error("Error completing minder:", error)
    } finally {
      setCompletingIds((prev) => {
        const next = new Set(prev)
        next.delete(minderId)
        return next
      })
    }
  }

  const handlePauseToggle = async (minderId: string) => {
    const updated = minders.map((m) =>
      m.id === minderId ? { ...m, paused: !m.paused } : m,
    )
    setMinders(updated)
    await AsyncStorage.setItem(MINDERS_STORAGE_KEY, JSON.stringify(updated))
    await scheduleNotificationsForAllMinders()
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  const handleMoveUp = async (id: string) => {
    const idx = minders.findIndex((m) => m.id === id)
    if (idx <= 0) return
    const updated = [...minders]
    ;[updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]]
    setMinders(updated)
    await AsyncStorage.setItem(MINDERS_STORAGE_KEY, JSON.stringify(updated))
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  const handleMoveDown = async (id: string) => {
    const idx = minders.findIndex((m) => m.id === id)
    if (idx < 0 || idx >= minders.length - 1) return
    const updated = [...minders]
    ;[updated[idx + 1], updated[idx]] = [updated[idx], updated[idx + 1]]
    setMinders(updated)
    await AsyncStorage.setItem(MINDERS_STORAGE_KEY, JSON.stringify(updated))
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  const openNoteModal = (minderId: string, preferredTriggerAt?: number) => {
    setNoteMinderId(minderId)
    setNoteText("")
    setNoteMood("neutral")

    if (typeof preferredTriggerAt === "number") {
      setNoteTriggerAt(preferredTriggerAt)
      setNoteModalVisible(true)
      return
    }

    const minder = minders.find((m) => m.id === minderId)
    if (!minder || minder.reminderFrequency === "Continuous") {
      setNoteTriggerAt(undefined)
      setNoteModalVisible(true)
      return
    }

    const now = Date.now()
    const candidateTriggerAts = (notifications as any[])
      .filter((n) => n?.content?.data?.minderId === minderId)
      .map((n) => n?.trigger?.timestamp)
      .filter(Boolean)
      .map((d: any) => new Date(d).getTime())
      .filter((t: any) => typeof t === "number" && !Number.isNaN(t)) as number[]

    if (candidateTriggerAts.length === 0) {
      const manualAt = Date.now()
      setNoteTriggerAt(manualAt)
      void addMinderEvent({
        id: `triggered:${minderId}:${manualAt}`,
        minderId,
        kind: "triggered",
        at: manualAt,
        triggerAt: manualAt,
      })
    } else {
      candidateTriggerAts.sort((a, b) => Math.abs(a - now) - Math.abs(b - now))
      setNoteTriggerAt(candidateTriggerAts[0])
    }
    setNoteModalVisible(true)
  }

  const saveNote = async () => {
    if (!noteMinderId) return
    const trimmed = noteText.trim()
    if (!trimmed) {
      setNoteModalVisible(false)
      return
    }

    const minder = minders.find((m) => m.id === noteMinderId)
    const logAt = Date.now()
    let triggerAtForLog = noteTriggerAt

    try {
      if (minder && minder.reminderFrequency !== "Continuous") {
        const snapped = getClosestTriggerAtWithinWindow(
          noteMinderId,
          logAt,
          15 * 60 * 1000,
        )
        if (typeof snapped === "number") {
          triggerAtForLog = snapped
          await addMinderEvent({
            id: `completed:${noteMinderId}:${snapped}`,
            minderId: noteMinderId,
            kind: "completed",
            at: logAt,
            triggerAt: snapped,
          })
        }
      }

      if (
        minder &&
        minder.reminderFrequency !== "Continuous" &&
        typeof triggerAtForLog !== "number"
      ) {
        const manualAt = logAt
        triggerAtForLog = manualAt
        await addMinderEvent({
          id: `triggered:${noteMinderId}:${manualAt}`,
          minderId: noteMinderId,
          kind: "triggered",
          at: manualAt,
          triggerAt: manualAt,
        })
      }

      await addMinderEvent({
        minderId: noteMinderId,
        kind: "log",
        at: logAt,
        text: trimmed,
        triggerAt: triggerAtForLog,
        mood: noteMood,
      })
    } catch (err) {
      console.error("Error saving log:", err)
      Alert.alert(
        "Save failed",
        "Your log could not be saved. Please try again.",
      )
      return
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setNoteModalVisible(false)
    void loadData()
  }

  const handleFail = async (minderId: string) => {
    try {
      const updatedMinders = minders.map((minder) => {
        if (minder.id === minderId) {
          return { ...minder, successStreak: 0 }
        }
        return minder
      })
      setMinders(updatedMinders)
      await AsyncStorage.setItem(
        MINDERS_STORAGE_KEY,
        JSON.stringify(updatedMinders),
      )
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    } catch (error) {
      console.error("Error updating minder:", error)
      Alert.alert("Error", "Failed to update the minder.")
    }
  }

  const getNextTriggerInfo = (minderId: string) => {
    const now = new Date()
    const minderNotifications = notifications
      .filter((notif) => notif.content.data.minderId === minderId)
      .map((notif) => {
        const t = notif.trigger as any
        const triggerDateValue = t?.value ?? t?.timestamp ?? t?.date
        if (!triggerDateValue) return null
        return new Date(triggerDateValue)
      })
      .filter(
        (date): date is Date =>
          date !== null && !isNaN((date as Date).getTime()),
      )

    const pastNotifications = minderNotifications
      .filter((date) => date <= now)
      .sort((a, b) => b.getTime() - a.getTime())

    const futureNotifications = minderNotifications
      .filter((date) => date > now)
      .sort((a, b) => a.getTime() - b.getTime())

    const minderCompletions = completions[minderId] || []

    for (const pastDate of pastNotifications) {
      const triggerAt = pastDate.getTime()
      const isHandled =
        (handledTriggerAtsByMinder[minderId] || []).includes(triggerAt) ||
        minderCompletions.some((compTime) => compTime > triggerAt)
      if (!isHandled) {
        return { date: pastDate, isPastDue: true }
      }
    }

    if (futureNotifications.length > 0) {
      return { date: futureNotifications[0], isPastDue: false }
    }

    return { date: null, isPastDue: false }
  }

  const formatTimeUntil = (date: Date | null) => {
    if (!date) return "Not scheduled"

    const now = new Date()
    const diffMs = date.getTime() - now.getTime()

    if (diffMs < 0) {
      return "Past due"
    }

    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMins / 60)
    const remainingMins = diffMins % 60

    if (diffHours > 0) {
      return `Due in ${diffHours}h ${remainingMins}m`
    }
    if (diffMins > 0) {
      return `Due in ${diffMins}m`
    }
    return "Due now"
  }

  const renderMinderItem = ({
    item,
    index,
  }: {
    item: Minder
    index: number
  }) => {
    const triggerInfo = getNextTriggerInfo(item.id)
    const now = new Date()
    const diffMs = triggerInfo.date
      ? triggerInfo.date.getTime() - now.getTime()
      : -1
    const isCompleting = completingIds.has(item.id)
    const isActionable =
      !item.paused &&
      !isCompleting &&
      (triggerInfo.isPastDue ||
        (triggerInfo.date && diffMs > 0 && diffMs <= 60 * 60 * 1000))
    const triggerAt = triggerInfo.date ? triggerInfo.date.getTime() : undefined

    const handlePress = () => {
      router.push({ pathname: "/create-minder", params: { minderId: item.id } })
    }

    return (
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.8}
        accessibilityLabel={`${item.name} minder. Tap to edit.`}
        accessibilityRole="button"
      >
        <View
          style={[
            styles.minderItem,
            { backgroundColor: item.color, opacity: item.paused ? 0.6 : 1 },
          ]}
        >
          <View style={styles.minderContent}>
            <View style={styles.minderNameRow}>
              <Text style={[styles.minderName, { color: "white" }]}>
                {item.name}
              </Text>
              {item.paused && (
                <View style={styles.pausedBadge}>
                  <Text style={styles.pausedBadgeText}>Paused</Text>
                </View>
              )}
            </View>
            {item.note && (
              <Text style={[styles.minderNote, { color: "white" }]}>
                {item.note}
              </Text>
            )}

            {item.reminderFrequency !== "Continuous" && (
              <>
                <Text
                  style={[styles.minderNote, { color: "white", marginTop: 8 }]}
                >
                  {item.reminderFrequency}, {item.quantity} times
                  {item.notificationStartTime && item.notificationEndTime
                    ? `  •  ${formatHHMM(item.notificationStartTime)} – ${formatHHMM(item.notificationEndTime)}`
                    : ""}
                </Text>
                {!item.paused && (
                  <Text
                    style={[
                      styles.minderNote,
                      { color: triggerInfo.isPastDue ? "#ffdddd" : "white" },
                    ]}
                  >
                    {formatTimeUntil(triggerInfo.date)}
                  </Text>
                )}
              </>
            )}

            {(() => {
              const s = minderStatsMap[item.id]
              if (!s || (s.completionRate === null && s.streak === 0)) return null
              return (
                <View style={styles.statsStrip}>
                  {s.streak > 0 && (
                    <View style={styles.statPill}>
                      <Text style={styles.statPillText}>🔥 {s.streak}d streak</Text>
                    </View>
                  )}
                  {s.completionRate !== null && (
                    <View style={styles.statPill}>
                      <Text style={styles.statPillText}>{s.completionRate}% this week</Text>
                    </View>
                  )}
                </View>
              )
            })()}

            {item.reminderFrequency === "Continuous" && !reorderMode && (
              <View style={styles.continuousContainer}>
                <Text style={{ color: "white" }}>
                  Success Streak: {item.successStreak || 0}
                </Text>
                <View style={styles.continuousButtons}>
                  <TouchableOpacity
                    style={[
                      styles.button,
                      { backgroundColor: "rgba(255, 255, 255, 0.3)" },
                    ]}
                    onPress={() => openNoteModal(item.id)}
                    accessibilityLabel={`Add log for ${item.name}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.buttonText}>Log</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.button,
                      { backgroundColor: "rgba(255, 255, 255, 0.3)" },
                    ]}
                    onPress={() => router.push(`/minder/${item.id}`)}
                    accessibilityLabel={`View history for ${item.name}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.buttonText}>History</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[
                    styles.button,
                    { backgroundColor: "rgba(255, 255, 255, 0.3)" },
                  ]}
                  onPress={() => handleComplete(item.id)}
                  accessibilityLabel={`Mark ${item.name} as success`}
                  accessibilityRole="button"
                >
                  <Text style={styles.buttonText}>Success</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.failButton]}
                  onPress={() => handleFail(item.id)}
                  accessibilityLabel={`Mark ${item.name} as not done`}
                  accessibilityRole="button"
                >
                  <Text style={styles.buttonText}>Not today</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {reorderMode ? (
            <View style={styles.rightActions}>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => handleMoveUp(item.id)}
                disabled={index === 0}
                accessibilityLabel={`Move ${item.name} up`}
                accessibilityRole="button"
              >
                <Ionicons
                  name="chevron-up"
                  size={24}
                  color="white"
                  style={{ opacity: index === 0 ? 0.3 : 1 }}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => handleMoveDown(item.id)}
                disabled={index === minders.length - 1}
                accessibilityLabel={`Move ${item.name} down`}
                accessibilityRole="button"
              >
                <Ionicons
                  name="chevron-down"
                  size={24}
                  color="white"
                  style={{ opacity: index === minders.length - 1 ? 0.3 : 1 }}
                />
              </TouchableOpacity>
            </View>
          ) : item.reminderFrequency !== "Continuous" ? (
            <View style={styles.rightActions}>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => handlePauseToggle(item.id)}
                accessibilityLabel={
                  item.paused ? `Resume ${item.name}` : `Pause ${item.name}`
                }
                accessibilityRole="button"
              >
                <Ionicons
                  name={
                    item.paused ? "play-circle-outline" : "pause-circle-outline"
                  }
                  size={20}
                  color="white"
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => router.push(`/minder/${item.id}`)}
                accessibilityLabel={`View history for ${item.name}`}
                accessibilityRole="button"
              >
                <Ionicons name="time-outline" size={20} color="white" />
              </TouchableOpacity>
              {item.minderType === "note" ? (
                <TouchableOpacity
                  style={styles.completeButton}
                  onPress={() => openNoteModal(item.id, triggerAt)}
                  disabled={!isActionable}
                  accessibilityLabel={
                    isActionable
                      ? `Add log for ${item.name}`
                      : `${item.name} not yet due`
                  }
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="create-outline"
                    size={32}
                    color={isActionable ? "white" : "rgba(255, 255, 255, 0.5)"}
                  />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.completeButton}
                  onPress={() => handleComplete(item.id, triggerAt)}
                  disabled={!isActionable}
                  accessibilityLabel={
                    isActionable
                      ? `Complete ${item.name}`
                      : `${item.name} not yet due`
                  }
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={32}
                    color={isActionable ? "white" : "rgba(255, 255, 255, 0.5)"}
                  />
                </TouchableOpacity>
              )}
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {notifStatus === "denied" && (
        <TouchableOpacity
          style={styles.permBanner}
          onPress={() => Linking.openSettings()}
          accessibilityLabel="Notifications are disabled. Tap to open Settings and enable them."
          accessibilityRole="button"
        >
          <Ionicons name="notifications-off-outline" size={16} color="white" />
          <Text style={styles.permBannerText}>
            Notifications are off. Tap to enable in Settings.
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={minders}
        renderItem={({ item, index }) => renderMinderItem({ item, index })}
        keyExtractor={(item) => item.id}
        style={{ width: "100%" }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              Your Minders
            </Text>
            <View
              style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
            >
              {minders.length > 1 && (
                <TouchableOpacity
                  style={[
                    styles.reorderButton,
                    {
                      backgroundColor: reorderMode ? colors.text : colors.card,
                    },
                  ]}
                  onPress={() => setReorderMode((r) => !r)}
                  accessibilityLabel={
                    reorderMode ? "Done reordering" : "Reorder minders"
                  }
                  accessibilityRole="button"
                >
                  <Ionicons
                    name={reorderMode ? "checkmark" : "swap-vertical-outline"}
                    size={18}
                    color={reorderMode ? colors.background : colors.text}
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.addButton, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/create-minder")}
                accessibilityLabel="Add a new minder"
                accessibilityRole="button"
              >
                <Text style={styles.addButtonText}>+ Add Minder</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🌱</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No minders yet
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.text }]}>
              Create a gentle reminder to check in with yourself throughout the
              day.
            </Text>
            <TouchableOpacity
              style={[styles.emptyButton, { backgroundColor: colors.primary }]}
              onPress={() => router.push("/create-minder")}
              accessibilityLabel="Create your first minder"
              accessibilityRole="button"
            >
              <Text style={styles.emptyButtonText}>
                Create Your First Minder
              </Text>
            </TouchableOpacity>
          </View>
        }
      />

      <Modal
        transparent
        animationType="fade"
        visible={noteModalVisible}
        onRequestClose={() => setNoteModalVisible(false)}
        accessibilityViewIsModal
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            accessibilityRole="none"
            accessibilityLabel="Add log dialog"
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Add a quick log
            </Text>
            {typeof noteTriggerAt === "number" && (
              <Text
                style={{ color: colors.text, opacity: 0.8, marginBottom: 10 }}
              >
                For reminder: {new Date(noteTriggerAt).toLocaleString()}
              </Text>
            )}
            <View style={styles.moodRow}>
              {(["good", "neutral", "bad"] as const).map((mood) => (
                <TouchableOpacity
                  key={mood}
                  onPress={() => setNoteMood(mood)}
                  style={[
                    styles.moodButton,
                    {
                      backgroundColor:
                        noteMood === mood ? colors.primary : colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                  accessibilityLabel={`Set mood to ${mood}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: noteMood === mood }}
                >
                  <Text
                    style={{
                      color: noteMood === mood ? "white" : colors.text,
                      fontWeight: "700",
                    }}
                  >
                    {mood === "good"
                      ? "😊 Good"
                      : mood === "neutral"
                        ? "😐 Neutral"
                        : "😟 Not great"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              placeholder="What do you want to reflect on?"
              placeholderTextColor={colors.text}
              multiline
              style={[
                styles.modalInput,
                { color: colors.text, borderColor: colors.border },
              ]}
              accessibilityLabel="Reflection text"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => setNoteModalVisible(false)}
                style={[
                  styles.modalButton,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
                accessibilityLabel="Cancel"
                accessibilityRole="button"
              >
                <Text style={{ color: colors.text, fontWeight: "600" }}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveNote}
                style={[
                  styles.modalButton,
                  {
                    backgroundColor: colors.primary,
                    borderColor: colors.primary,
                  },
                ]}
                accessibilityLabel="Save log entry"
                accessibilityRole="button"
              >
                <Text style={{ color: "white", fontWeight: "700" }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    alignItems: "center",
  },
  permBanner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#E57373",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  permBannerText: {
    color: "white",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  header: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
  },
  addButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  reorderButton: {
    padding: 8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 24,
    gap: 16,
  },
  emptyEmoji: {
    fontSize: 64,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: "center",
    opacity: 0.7,
    lineHeight: 22,
  },
  emptyButton: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  emptyButtonText: {
    color: "white",
    fontWeight: "700",
    fontSize: 16,
  },
  minderItem: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.23,
    shadowRadius: 2.62,
    elevation: 4,
  },
  minderContent: {
    flex: 1,
    marginRight: 16,
  },
  minderNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  minderName: {
    fontSize: 18,
    fontWeight: "bold",
    flexShrink: 1,
  },
  pausedBadge: {
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pausedBadgeText: {
    color: "white",
    fontSize: 11,
    fontWeight: "700",
  },
  minderNote: {
    fontSize: 14,
    marginTop: 4,
    opacity: 0.9,
  },
  statsStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  statPill: {
    backgroundColor: "rgba(0,0,0,0.22)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statPillText: {
    color: "white",
    fontSize: 11,
    fontWeight: "700",
  },
  continuousContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    flexWrap: "wrap",
  },
  continuousButtons: {
    flexDirection: "row",
    gap: 10,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  failButton: {
    backgroundColor: "rgba(255, 80, 80, 0.8)",
  },
  buttonText: {
    color: "white",
    fontWeight: "bold",
  },
  completeButton: {
    paddingLeft: 16,
  },
  rightActions: {
    alignItems: "center",
    gap: 10,
    paddingLeft: 12,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "#00000055",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },
  moodRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  moodButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  modalInput: {
    minHeight: 90,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 12,
  },
  modalButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
})
