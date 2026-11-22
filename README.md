# 📱 Phone pe Android App banao — Termux + OpenCode

> **Veer AI** — phone pe AI se app banao
> Based on the open-source (MIT) Termux-setup by [HunterisLive](https://github.com/HunterisLive-1)

Bina laptop, sirf phone se: **OpenCode (AI) se app likhwao aur phone pe hi APK banao.**
Ek script, sirf Termux — koi Ubuntu nahi.

**Zaroorat:** Android 7+, 6 GB+ RAM wala phone, ~4 GB khali jagah, WiFi (~1 GB download).

---

## Step 0: Termux Install Karo

> ⚠️ **Play Store wala mat lena — outdated hai!**

** Termux Yaha se install karo **👇 
. [Download Termux](https://github.com/HunterisLive-1/Turmux-setup/releases/download/V1.1/Termux.apk)

** Code editor install **
 [Download Code-editor](https://github.com/HunterisLive-1/Turmux-setup/releases/download/V1.1/Code.Editor.apk)

---

## Step 1: Setup Script Chalao

Termux kholo aur ye do command chalao:

`veer.sh` file ko phone ke Download folder me rakho, phir Termux me:

```bash
termux-setup-storage
cp /sdcard/Download/veer.sh ~/
```

```bash
bash veer.sh
```

- Naam poochega → banner ke liye (jaise: Veer)
- Storage ka popup aayega → **Allow**
- Time: ~10-15 min. Beech mein koi sawaal nahi aata.
- Kuch fail hua to script naam ke saath batata hai — `bash veer.sh` dobara chalao, jo ho chuka hai wo skip hoga.

Ye install karta hai:

| Kya | Kyun |
|:----|:-----|
| OpenCode (+ glibc-runner) | AI se code likhwane ke liye (free models bhi) |
| **Veer AI** (`veer`) | Apna OpenCode-jaisa AI agent: files padhta/likhta/edit karta hai, command chalata hai |
| Java 17 + Gradle | APK build ke liye |
| Android SDK 35 | Android ki library |
| aapt2, apksigner (phone wale) | Google wale phone pe nahi chalte |
| zsh + p10k + rainbow banner | Sundar terminal |

Aakhir mein ek test app banta hai: **Download/hello-veer.apk** — Files app se kholo, install karo. Screen pe likha aayega: *"Ye app phone pe hi bana hai!"*

**Ho jaane ke baad Termux band karke kholo.**

---

## Step 2: OpenCode se App Banwao

Test project mein OpenCode kholo:

```bash
cd ~/hello-veer
```

```bash
opencode
```

Pehli baar `/models` likho aur koi **free** model chuno (naam ke aakhir mein `-free`, jaise `deepseek-v4.1-flash-free`) — API key nahi chahiye. Apni key lagani ho to bahar `opencode auth login`. Phir OpenCode ko bolo, jaise:

```
Is project mein ek simple calculator app bana do. Sirf MainActivity.kt badlo, koi nayi library mat jodna.
```

---

## Veer AI — apna AI agent (`veer`)

OpenCode jaisa hi: chat karo, wo project ki files padhega, code likhega/edit karega, aur `bash` se build bhi chalayega. Koi extra package nahi, sirf Node.

```bash
cd ~/hello-veer
veer
```

| Command | Kaam |
|:--|:--|
| `veer` | Chat shuru (ya `ai`) |
| `veer -c` | Pichhli baat wapas (is folder ki) |
| `veer run "calculator bana do"` | Ek kaam karke band |
| `veer build` | APK banao, Download me copy (`vb` bhi chalta hai) |
| `veer build -y` | Build fail ho to AI khud fix kare |
| `veer models` | Model list se chuno (free wale pe `(free)`) |
| `veer login` | API key save karo |

Chat ke andar:

| | |
|:--|:--|
| `/build` | APK banao. Fail ho to poochhega "AI se fix karwao?" |
| `/undo` | AI ne jo files badli, pichhla turn wapas |
| `/init` | `AGENTS.md` banwao |
| `/compact` | Lambi baat ka summary (context bachao) |
| `/context` | Kitna context bhar gaya |
| `/models` `/model <naam>` | Model badlo |
| `/auto` `/clear` `/key` `/help` `/exit` | Baaki |

- `@file.kt` likho to wo file AI ko saath me mil jaati hai. Lambi line ke liye line ke aakhir me `\` lagao.
- AI ke paas tools: file padhna/likhna/edit, `glob`, `grep`, `web_fetch` (docs padhne ke liye), `bash`.
- File likhne / edit karne / command chalane se pehle puchta hai (edit me kya badlega wo dikhata hai). `a` dabao = baaki sab auto, band karne ke liye `/auto`.
- Server busy ya net atke to khud 2 baar dobara try karta hai. `Ctrl+C` = AI ko beech me roko.
- Project folder me `AGENTS.md` rakho to wo har baar padhta hai (jaise: "Sirf Kotlin, koi library mat jodna").
- Default: OpenCode Zen (`https://opencode.ai/zen/v1`) ka `big-pickle`. Free models badalte rehte hain aur key maang sakte hain, isliye `veer models` se dekho aur key `opencode.ai/auth` se lo.
- Apna provider (koi bhi OpenAI-compatible): `~/.veer-ai/config.json` me `baseURL`, `apiKey`, `model` badlo, ya env: `VEER_BASE_URL`, `VEER_API_KEY`, `VEER_MODEL`.

---

## Step 3: APK Banao aur Install Karo

OpenCode se bahar aake:

```bash
./gradlew assembleDebug
```

```bash
cp app/build/outputs/apk/debug/app-debug.apk /sdcard/Download/
```

Files app → Download → **app-debug.apk** → Install.

**Naya project?** Uske folder mein `gradlew` daalne ke liye:

```bash
addwrapper
```

---

## Sirf APK Banane Ka Setup (bina zsh / OpenCode)

Sirf Java + Android SDK chahiye (jaise Maya se app banwane ke liye)? Ye ek command, koi sawaal nahi poochti:

`android-setup.sh` ko bhi Download me rakho:

```bash
cp /sdcard/Download/android-setup.sh ~/ && bash android-setup.sh
```

Aakhir mein `ANDROID_SETUP_OK` aaye to ready.

---

## 🎨 Look Badalna Ho

Script Veer AI wala p10k look lagata hai. Apna look chuno:

```bash
p10k configure
```

---

## ⚡ Aliases

| Alias | Kaam |
|:------|:-----|
| `c` | Screen saaf |
| `update` | Sab update karo |
| `coding` | `/sdcard/coding` folder |
| `addwrapper` | Project mein `gradlew` daalo |
| `ai` | `veer` (Veer AI) chalao |

---

## 🔧 Troubleshooting

### ❌ Termux kholte hi upar lamba peela "instant prompt" warning

Naya `veer.sh` ise khud band karta hai. Purana setup ho to:

```bash
echo 'typeset -g POWERLEVEL9K_INSTANT_PROMPT=off' >> ~/.zshrc
```

Phir Termux band karke kholo.

### ❌ pkg update pe "File has unexpected size ... Mirror sync in progress?"

`veer.sh` khud default mirror lagata hai. Haath se:

```bash
termux-change-repo
```

"Single mirror" → "default" chuno.

### ❌ Gradle: "AAPT2 ... Daemon startup failed"

Gradle PC wala aapt2 download karta hai jo phone pe nahi chalta. Check karo:

```bash
cat ~/.gradle/gradle.properties
```

Isme `android.aapt2FromMavenOverride=` wali line honi chahiye. Na ho to `bash veer.sh` dobara chalao.

### ❌ `./gradlew: No such file or directory`

Project mein `gradlew` nahi hai. Project folder mein:

```bash
addwrapper
```

### ❌ Build bahut slow / phone garam

Pehla build 3-5 min normal hai (sab download hota hai). Baaki apps band rakho. 6 GB+ RAM best.

### ❌ P10k icons broken dikhte hain

Termux band karke kholo (font lagta hai). Phir bhi ho to `p10k configure` mein icons ke liye "No" chuno.

---

## 🔗 Links

| | |
|:--|:--|
| **Original setup (MIT)** | [HunterisLive-1/Turmux-setup](https://github.com/HunterisLive-1/Turmux-setup) |
| **Termux** | [termux.dev](https://termux.dev) |
| **OpenCode** | [opencode.ai](https://opencode.ai) |
| **Powerlevel10k** | [github.com/romkatv/powerlevel10k](https://github.com/romkatv/powerlevel10k) |

---

> 💜 Agar ye helpful laga to share zaroor karna!