# First models to integrate

## DeepSeek V4 Pro / Flash

* Ollama Cloud: deepseek-v4-flash / deepseek-v4-pro
* nano-gpt: deepseek/deepseek-v4-flash / deepseek/deepseek-v4-pro
* Novita AI: deepseek/deepseek-v4-flash / deepseek/deepseek-v4-pro  

Sind Reasoning-Modelle, mit Tool-Use, wir setzen Kontext aus Kostengründen auf 200.000 (recommended) und 1.000.000 (maximum)  

## GLM 5 / 5.1

Hier unterstützen wir beide - die Community hat Probleme damit, rauszufinden, welches davon besser ist im Moment... ich gehe zwar davon aus, dass das RLHF für 5.1 nicht strikter ist als 5 (zumindest aus eigenen Erfahrungen), aber ich kanns wirklich nicht genau sagen, weil die chinesischen Modelle manchmal echt heftig driften zwischen Prompts und Iterationen.

* Ollama Cloud: glm-5 / glm-5.1
* nano-gpt: zai-org/glm-5 / zai-org/glm-5.1
* Novita AI: zai-org/glm-5 / zai-org/glm-5.1

Sind Reasoning-Modell, ebenfalls mit Tool-Use, Kontext ist 200.000 sowohl recommended als auch Maximum.

## Kimi K2.6

Auch Publikumsliebling - hier kann ich sagen, dass 2.6 sogar ein Fortschritt gegenüber 2.5 war, was unseren Use-Case betrifft, darum nur 2.6 Support.

* Ollama Cloud: kimi-k2.6
* nano-gpt: moonshotai/kimi-k2.6
* Novita AI: moonshotai/kimi-k2.6

Können Reasoning, Tools und auch Visual (übrigens sehr gut sogar). Context Size ist 256.000 sowohl recommended als auch Maximum.

## Gemma 4 31B

Der Überraschungskandidat - nicht nur, weils von Google ist, sondern weils ein Modell ist, das man auf einer ordentlichen GPU sogar daheim ausführen kann.

Im Prinzip vollkommen unzensiert, was legale Zwecke betrifft (und damit prime candidate für uns) - ungewöhnlich für ein US-Modell, aber ich werde mich definitiv nicht beschweren, und in der Community auch niemand.

Ist auch ordentlich aufgestellt, also von den Caps her.

Einzige Downside: ur schlampig was Tool-Use betrifft - ich überlege deshalb, später auch Qwen 3.6 aufzunehmen, weil auch das immer populärer wird unter den kleinen Modellen, aber das kommt später.

* Ollama Cloud: gemma4:31b
* nano-gpt: google/gemma-4-31b-it
* Novita AI: google/gemma-4-31b-it

Kann Reasoning, Tools, Vision. Context Window von 262.144 sowohl recommended als auch Maximum.