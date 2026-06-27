# Model behaviour

Fine-tune how the model thinks when chatting as this persona.

## Temperature

Controls how creative and unpredictable the model's replies are. The default of 0.85 is a good balance. Lower values produce more focused, consistent responses; higher values add more variety and spontaneity. Adjustable in 0.05 steps from 0.00 to 2.00.

## Context window

How many tokens the model keeps in memory for each conversation. The green zone covers the recommended range; the red zone extends to the model's maximum but trades off cost, speed, and often quality. Use the **Use default** button to reset to the model's recommendation.

This control appears only when a model has been selected on the hub. If you see the note instead, go back to the hub and choose a provider and model first.

## Ask an expert by default

When enabled, new chats with this persona will automatically route complex questions to the global expert model you have configured in **My Settings → Ask an Expert**. You can override this per chat from the cockpit. The toggle is disabled until a global expert model is set.
