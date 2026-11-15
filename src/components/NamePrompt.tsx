import { useState } from 'react';
import { View, Text, Pressable, Modal, TextInput } from 'react-native';

import { useTheme } from '../theme';

export function NamePrompt({
  visible,
  title,
  placeholder,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const { styles, t } = useTheme();
  const [name, setName] = useState('');

  const close = () => {
    setName('');
    onClose();
  };
  const submit = () => {
    const n = name.trim();
    if (n) onSubmit(n);
    close();
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{title}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={placeholder}
            placeholderTextColor={t.muted}
            autoFocus
            style={styles.input}
            onSubmitEditing={submit}
            returnKeyType="done"
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Pressable style={[styles.btn, styles.btnGray, { flex: 1 }]} onPress={close}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnBlue, { flex: 1 }]} onPress={submit}>
              <Text style={[styles.btnText, { color: '#fff' }]}>Add</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
