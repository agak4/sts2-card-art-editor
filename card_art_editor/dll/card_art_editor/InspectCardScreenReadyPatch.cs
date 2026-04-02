using System;
using System.Runtime.CompilerServices;
using HarmonyLib;
using MegaCrit.Sts2.Core.Nodes.Screens;

namespace CardArtEditorBootstrap
{
	// Token: 0x02000003 RID: 3
	[HarmonyPatch(typeof(NInspectCardScreen), "_Ready")]
	internal static class InspectCardScreenReadyPatch
	{
		// Token: 0x06000009 RID: 9 RVA: 0x00002431 File Offset: 0x00000631
		[NullableContext(1)]
		private static void Postfix(NInspectCardScreen __instance)
		{
			Bootstrap.OnInspectCardScreenReady(__instance);
		}
	}
}
