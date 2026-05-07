import { Ionicons } from "@expo/vector-icons"
import * as Haptics from "expo-haptics"
import { useEffect, useRef, useState } from "react"
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useTheme } from "../context/ThemeContext"
import {
  Holiday,
  HolidayType,
  getHolidays,
  getNextOccurrence,
  getOrdinal,
  saveHolidays,
  scheduleHolidayNotifications,
} from "../logic/HolidayManager"

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

const TYPE_LABELS: Record<string, string> = {
  birthday: "Birthday",
  anniversary: "Anniversary",
  custom: "Custom",
}

const USER_TYPES: HolidayType[] = ["birthday", "anniversary", "custom"]

export default function HolidaysScreen() {
  const { colors } = useTheme()
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [addModalVisible, setAddModalVisible] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState("")
  const [draftType, setDraftType] = useState<HolidayType>("birthday")
  const [draftMonth, setDraftMonth] = useState(1)
  const [draftDay, setDraftDay] = useState(1)
  const [draftYear, setDraftYear] = useState("")
  const [monthPickerVisible, setMonthPickerVisible] = useState(false)
  const [dayPickerVisible, setDayPickerVisible] = useState(false)
  const monthScrollRef = useRef<ScrollView>(null)
  const dayScrollRef = useRef<ScrollView>(null)

  useEffect(() => {
    void getHolidays().then(setHolidays)
  }, [])

  useEffect(() => {
    if (!monthPickerVisible) return
    const ITEM_HEIGHT = 44
    const offset = Math.max(0, (draftMonth - 1) * ITEM_HEIGHT - ITEM_HEIGHT * 2)
    setTimeout(
      () => monthScrollRef.current?.scrollTo({ y: offset, animated: false }),
      50,
    )
  }, [monthPickerVisible, draftMonth])

  useEffect(() => {
    if (!dayPickerVisible) return
    const ITEM_HEIGHT = 44
    const offset = Math.max(0, (draftDay - 1) * ITEM_HEIGHT - ITEM_HEIGHT * 2)
    setTimeout(
      () => dayScrollRef.current?.scrollTo({ y: offset, animated: false }),
      50,
    )
  }, [dayPickerVisible, draftDay])

  const persist = async (updated: Holiday[]) => {
    setHolidays(updated)
    await saveHolidays(updated)
    void scheduleHolidayNotifications()
  }

  const handleToggle = async (id: string, value: boolean) => {
    await persist(
      holidays.map((h) => (h.id === id ? { ...h, enabled: value } : h)),
    )
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  const openAdd = () => {
    setEditingId(null)
    setDraftName("")
    setDraftType("birthday")
    setDraftMonth(1)
    setDraftDay(1)
    setDraftYear("")
    setAddModalVisible(true)
  }

  const openEdit = (holiday: Holiday) => {
    setEditingId(holiday.id)
    setDraftName(holiday.name)
    setDraftType(holiday.type)
    setDraftMonth(holiday.month || 1)
    setDraftDay(holiday.day || 1)
    setDraftYear(holiday.year ? String(holiday.year) : "")
    setAddModalVisible(true)
  }

  const handleDelete = (id: string) => {
    Alert.alert(
      "Remove Event",
      "This will remove the event and cancel its reminders.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await persist(holidays.filter((h) => h.id !== id))
          },
        },
      ],
    )
  }

  const handleSaveDraft = async () => {
    if (!draftName.trim()) {
      Alert.alert("Name required", "Please enter a name for this event.")
      return
    }
    const maxDay = new Date(2000, draftMonth, 0).getDate()
    const clampedDay = Math.min(draftDay, maxDay)

    let parsedYear: number | undefined
    if (draftYear.trim()) {
      const y = parseInt(draftYear.trim(), 10)
      const currentYear = new Date().getFullYear()
      if (isNaN(y) || y < 1900 || y > currentYear) {
        Alert.alert(
          "Invalid year",
          `Year must be between 1900 and ${currentYear}.`,
        )
        return
      }
      parsedYear = y
    }

    if (editingId) {
      await persist(
        holidays.map((h) =>
          h.id === editingId
            ? {
                ...h,
                name: draftName.trim(),
                type: draftType,
                month: draftMonth,
                day: clampedDay,
                year: parsedYear,
              }
            : h,
        ),
      )
    } else {
      const newHoliday: Holiday = {
        id: `user-${Date.now()}`,
        name: draftName.trim(),
        type: draftType,
        month: draftMonth,
        day: clampedDay,
        year: parsedYear,
        enabled: true,
      }
      await persist([...holidays, newHoliday])
    }
    setAddModalVisible(false)
  }

  const formatDateLabel = (holiday: Holiday): string => {
    if (holiday.id === "mothersday") return "2nd Sunday of May"
    if (holiday.id === "fathersday") return "3rd Sunday of June"
    return `${MONTH_NAMES[holiday.month - 1]} ${holiday.day}${holiday?.year ? `, ${holiday.year}` : ""}`
  }

  const formatNextDate = (holiday: Holiday): string => {
    const next = getNextOccurrence(holiday)
    const dateStr = next.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    if (holiday.year) {
      const n = next.getFullYear() - holiday.year
      if (n > 0) {
        const label =
          holiday.type === "birthday"
            ? `${getOrdinal(n)} Birthday`
            : holiday.type === "anniversary"
              ? `${getOrdinal(n)} Anniversary`
              : getOrdinal(n)
        return `${label} — ${dateStr}`
      }
    }
    return dateStr
  }

  const maxDayForMonth = new Date(2000, draftMonth, 0).getDate()
  const dayOptions = Array.from({ length: maxDayForMonth }, (_, i) => i + 1)
  const builtIn = holidays.filter((h) => h.type === "builtin")
  const userEvents = holidays.filter((h) => h.type !== "builtin")

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["bottom"]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.description, { color: colors.text }]}>
          Get reminders 45, 30, and 15 days before — then daily for the final 7
          days.
        </Text>

        <Text style={[styles.sectionHeader, { color: colors.text }]}>
          Holidays
        </Text>
        {builtIn.map((holiday) => (
          <View
            key={holiday.id}
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardName, { color: colors.text }]}>
                  {holiday.name}
                </Text>
                <Text style={[styles.cardSub, { color: colors.text }]}>
                  {formatDateLabel(holiday)}
                </Text>
                <Text style={[styles.cardNext, { color: colors.primary }]}>
                  Next: {formatNextDate(holiday)}
                </Text>
              </View>
              <Switch
                value={holiday.enabled}
                onValueChange={(v) => handleToggle(holiday.id, v)}
                accessibilityLabel={`Toggle reminders for ${holiday.name}`}
              />
            </View>
          </View>
        ))}

        <View style={styles.sectionRow}>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>
            My Events
          </Text>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
            onPress={openAdd}
            accessibilityLabel="Add a birthday or anniversary"
            accessibilityRole="button"
          >
            <Ionicons name="add" size={18} color="white" />
            <Text style={styles.addBtnText}>Add Event</Text>
          </TouchableOpacity>
        </View>

        {userEvents.length === 0 && (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.emptyText, { color: colors.text }]}>
              Add birthdays, anniversaries, or any date you'd like reminders
              for.
            </Text>
          </View>
        )}

        {userEvents.map((holiday) => (
          <View
            key={holiday.id}
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardRow}>
              <View style={{ flex: 1 }}>
                <View style={styles.nameRow}>
                  <Text style={[styles.cardName, { color: colors.text }]}>
                    {holiday.name}
                  </Text>
                  <View
                    style={[
                      styles.typeBadge,
                      { backgroundColor: colors.primary + "22" },
                    ]}
                  >
                    <Text
                      style={[styles.typeBadgeText, { color: colors.primary }]}
                    >
                      {TYPE_LABELS[holiday.type] ?? "Custom"}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.cardSub, { color: colors.text }]}>
                  {formatDateLabel(holiday)}
                </Text>
                <Text style={[styles.cardNext, { color: colors.primary }]}>
                  Next: {formatNextDate(holiday)}
                </Text>
              </View>
              <View style={styles.userActions}>
                <Switch
                  value={holiday.enabled}
                  onValueChange={(v) => handleToggle(holiday.id, v)}
                  accessibilityLabel={`Toggle reminders for ${holiday.name}`}
                />
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => openEdit(holiday)}
                  accessibilityLabel={`Edit ${holiday.name}`}
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="pencil-outline"
                    size={18}
                    color={colors.text}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => handleDelete(holiday.id)}
                  accessibilityLabel={`Delete ${holiday.name}`}
                  accessibilityRole="button"
                >
                  <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Add / Edit Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={addModalVisible}
        onRequestClose={() => setAddModalVisible(false)}
        accessibilityViewIsModal
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingId ? "Edit Event" : "Add Event"}
            </Text>

            <TextInput
              style={[
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
              placeholder="Name (e.g. Mom's Birthday)"
              placeholderTextColor={colors.text + "88"}
              value={draftName}
              onChangeText={setDraftName}
              accessibilityLabel="Event name"
            />

            <Text style={[styles.fieldLabel, { color: colors.text }]}>
              Type
            </Text>
            <View style={styles.typeRow}>
              {USER_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.typeBtn,
                    {
                      backgroundColor:
                        draftType === t ? colors.primary : colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => setDraftType(t)}
                  accessibilityLabel={TYPE_LABELS[t]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: draftType === t }}
                >
                  <Text
                    style={{
                      color: draftType === t ? "white" : colors.text,
                      fontWeight: "600",
                      fontSize: 13,
                    }}
                  >
                    {TYPE_LABELS[t]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: colors.text }]}>
              Date
            </Text>
            <View style={styles.dateRow}>
              <TouchableOpacity
                style={[
                  styles.datePicker,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setMonthPickerVisible(true)}
                accessibilityLabel={`Month: ${MONTH_NAMES[draftMonth - 1]}`}
                accessibilityRole="button"
              >
                <Text style={{ color: colors.text }}>
                  {MONTH_NAMES[draftMonth - 1]}
                </Text>
                <Ionicons name="chevron-down" size={14} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.dayPicker,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setDayPickerVisible(true)}
                accessibilityLabel={`Day: ${draftDay}`}
                accessibilityRole="button"
              >
                <Text style={{ color: colors.text }}>{draftDay}</Text>
                <Ionicons name="chevron-down" size={14} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.fieldLabel, { color: colors.text }]}>
              {draftType === "birthday"
                ? "Birth Year"
                : draftType === "anniversary"
                  ? "Year Started"
                  : "Year"}{" "}
              <Text style={[styles.yearHint, { color: colors.text }]}>
                (optional)
              </Text>
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
              placeholder={`e.g. ${new Date().getFullYear() - 30}`}
              placeholderTextColor={colors.text + "88"}
              value={draftYear}
              onChangeText={setDraftYear}
              keyboardType="number-pad"
              maxLength={4}
              accessibilityLabel="Start year (optional)"
            />
            <Text style={[styles.yearHintText, { color: colors.text }]}>
              Used to show "23rd Birthday" or "7th Anniversary" in reminders.
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setAddModalVisible(false)}
                accessibilityLabel="Cancel"
                accessibilityRole="button"
              >
                <Text style={{ color: colors.text, fontWeight: "600" }}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  {
                    backgroundColor: colors.primary,
                    borderColor: colors.primary,
                  },
                ]}
                onPress={handleSaveDraft}
                accessibilityLabel="Save event"
                accessibilityRole="button"
              >
                <Text style={{ color: "white", fontWeight: "700" }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Month Picker */}
      <Modal
        transparent
        animationType="fade"
        visible={monthPickerVisible}
        onRequestClose={() => setMonthPickerVisible(false)}
        accessibilityViewIsModal
      >
        <View style={styles.pickerOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setMonthPickerVisible(false)}
          />
          <View
            style={[
              styles.pickerCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.pickerTitle, { color: colors.text }]}>
              Select Month
            </Text>
            <ScrollView ref={monthScrollRef} style={{ maxHeight: 300 }}>
              {MONTH_NAMES.map((name, idx) => {
                const isSelected = draftMonth === idx + 1
                return (
                  <TouchableOpacity
                    key={name}
                    style={[
                      styles.pickerOption,
                      {
                        backgroundColor: isSelected
                          ? colors.primary
                          : "transparent",
                      },
                    ]}
                    onPress={() => {
                      setDraftMonth(idx + 1)
                      setMonthPickerVisible(false)
                    }}
                  >
                    <Text
                      style={{
                        color: isSelected ? "white" : colors.text,
                        paddingVertical: 10,
                      }}
                    >
                      {name}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Day Picker */}
      <Modal
        transparent
        animationType="fade"
        visible={dayPickerVisible}
        onRequestClose={() => setDayPickerVisible(false)}
        accessibilityViewIsModal
      >
        <View style={styles.pickerOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setDayPickerVisible(false)}
          />
          <View
            style={[
              styles.pickerCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.pickerTitle, { color: colors.text }]}>
              Select Day
            </Text>
            <ScrollView ref={dayScrollRef} style={{ maxHeight: 300 }}>
              {dayOptions.map((d) => {
                const isSelected = draftDay === d
                return (
                  <TouchableOpacity
                    key={d}
                    style={[
                      styles.pickerOption,
                      {
                        backgroundColor: isSelected
                          ? colors.primary
                          : "transparent",
                      },
                    ]}
                    onPress={() => {
                      setDraftDay(d)
                      setDayPickerVisible(false)
                    }}
                  >
                    <Text
                      style={{
                        color: isSelected ? "white" : colors.text,
                        paddingVertical: 10,
                      }}
                    >
                      {d}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  description: { fontSize: 13, opacity: 0.65, lineHeight: 19, marginBottom: 4 },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    opacity: 0.55,
    marginTop: 10,
    marginBottom: 2,
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
    marginBottom: 2,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  addBtnText: { color: "white", fontWeight: "700", fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  cardName: { fontSize: 16, fontWeight: "700" },
  cardSub: { fontSize: 13, opacity: 0.6, marginTop: 2 },
  cardNext: { fontSize: 12, fontWeight: "600", marginTop: 4 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeBadgeText: { fontSize: 11, fontWeight: "700" },
  userActions: { alignItems: "center", gap: 6 },
  iconBtn: { padding: 4 },
  emptyCard: { borderWidth: 1, borderRadius: 12, padding: 16 },
  emptyText: {
    fontSize: 14,
    opacity: 0.6,
    textAlign: "center",
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "#00000055",
    justifyContent: "flex-end",
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 24,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  fieldLabel: { fontSize: 13, fontWeight: "600", opacity: 0.7 },
  typeRow: { flexDirection: "row", gap: 8 },
  typeBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  dateRow: { flexDirection: "row", gap: 10 },
  datePicker: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  dayPicker: {
    width: 72,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  yearHint: { fontSize: 12, opacity: 0.5, fontWeight: "400" },
  yearHintText: { fontSize: 11, opacity: 0.45, lineHeight: 15, marginTop: -8 },
  modalButtons: { flexDirection: "row", gap: 10, marginTop: 4 },
  modalBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "#00000040",
    alignItems: "center",
    justifyContent: "center",
  },
  pickerCard: { width: "80%", borderRadius: 12, padding: 16, borderWidth: 1 },
  pickerTitle: { fontSize: 16, fontWeight: "600", marginBottom: 12 },
  pickerOption: { borderRadius: 8, paddingHorizontal: 12, marginBottom: 6 },
})
