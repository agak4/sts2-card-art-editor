using System;
using System.Runtime.CompilerServices;
using HarmonyLib;
using MegaCrit.Sts2.Core.Nodes.Screens;

namespace CardArtEditorBootstrap
{
	// Token: 0x02000004 RID: 4
	[HarmonyPatch(typeof(NInspectCardScreen), "UpdateCardDisplay")]
	internal static class InspectCardScreenUpdateCardDisplayPatch
	{
		// Token: 0x0600000C RID: 12 RVA: 0x0000287D File Offset: 0x00000A7D
		[NullableContext(1)]
		private static void Postfix(NInspectCardScreen __instance)
		{
			Bootstrap.UpdateInspectCardMetadata(__instance);
		}
	}
}
